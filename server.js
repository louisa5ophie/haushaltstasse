const express=require("express");
const path=require("path");
const crypto=require("crypto");
const fs=require("fs");
const bcrypt=require("bcryptjs");
const {Pool}=require("pg");

const app=express();

app.use(express.json({limit:"1mb"}));
app.use(express.urlencoded({extended:false}));

const pool=new Pool({
  connectionString:process.env.DATABASE_URL
});

const SESSION_DAYS=30;
const TZ="Europe/Berlin";
const BIWEEKLY_ANCHOR="2026-10-05";


/* =========================
   HILFSFUNKTIONEN
========================= */

function cookieOpts(){
  return `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS*86400}`;
}

function hashToken(token){
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

function tasks(){

  return JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "public",
        "data.json"
      ),
      "utf8"
    )
  ).tasks;
}


/* =========================
   BERLINER DATUM
========================= */

function berlinParts(date=new Date()){

  const parts=
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:TZ,
        year:"numeric",
        month:"2-digit",
        day:"2-digit"
      }
    ).formatToParts(date);

  const result={};

  for(const part of parts){

    if(part.type!=="literal"){
      result[part.type]=Number(part.value);
    }

  }

  return result;
}


/* =========================
   ISO-KALENDERWOCHE
========================= */

function isoWeek(year,month,day){

  const date=
    new Date(
      Date.UTC(
        year,
        month-1,
        day
      )
    );

  const weekday=
    (date.getUTCDay()+6)%7;

  const monday=
    new Date(date);

  monday.setUTCDate(
    date.getUTCDate()-weekday
  );

  const thursday=
    new Date(monday);

  thursday.setUTCDate(
    monday.getUTCDate()+3
  );

  const weekYear=
    thursday.getUTCFullYear();

  const jan4=
    new Date(
      Date.UTC(
        weekYear,
        0,
        4
      )
    );

  const jan4Weekday=
    (jan4.getUTCDay()+6)%7;

  const firstMonday=
    new Date(jan4);

  firstMonday.setUTCDate(
    jan4.getUTCDate()-jan4Weekday
  );

  const week=
    Math.round(
      (monday-firstMonday)/
      604800000
    )+1;

  return {
    year:weekYear,
    week,
    key:
      `${weekYear}-W${String(week).padStart(2,"0")}`,
    monday
  };
}


/* =========================
   AKTUELLE ZEITRÄUME
========================= */

function periods(){

  const d=berlinParts();

  const week=
    isoWeek(
      d.year,
      d.month,
      d.day
    );

  const anchor=
    new Date(
      `${BIWEEKLY_ANCHOR}T00:00:00Z`
    );

  const diff=
    Math.round(
      (week.monday-anchor)/
      604800000
    );

  const biweeklyActive=
    diff>=0 &&
    diff%2===0;

  return {

    week:
      `weekly:${week.key}`,

    weekLabel:
      week.key,

    biweeklyActive,

    biweekly:
      biweeklyActive
        ?`biweekly:${week.key}`
        :null
  };
}


/* =========================
   FAIRNESS-ZUTEILUNG
========================= */

async function fairnessAssign(task,period){

  /* Bereits vorhanden? */
  const existing=
    await pool.query(
      `
      SELECT assigned_to
      FROM assignments
      WHERE task_id=$1
      AND period=$2
      `,
      [
        task.id,
        period
      ]
    );

  if(existing.rowCount){
    return existing.rows[0].assigned_to;
  }


  /*
     Gesamte bisherige Belastung
     aus allen Zuteilungen.
  */
  const history=
    await pool.query(
      `
      SELECT
        task_id,
        assigned_to,
        created_at
      FROM assignments
      WHERE assigned_to IN ('Louisa','Patrick')
      `
    );


  const allTasks=tasks();

  const load={
    Louisa:{
      total:0,
      recent:0
    },
    Patrick:{
      total:0,
      recent:0
    }
  };


  /*
     Die letzten 42 Tage werden
     stärker gewichtet.
  */
  const cutoff=
    Date.now()-
    42*86400000;


  for(const row of history.rows){

    const historyTask=
      allTasks.find(
        x=>x.id===Number(row.task_id)
      );

    if(
      !historyTask||
      historyTask.shared
    ){
      continue;
    }

    const points=
      Number(historyTask.points)||0;

    if(
      row.assigned_to!=="Louisa" &&
      row.assigned_to!=="Patrick"
    ){
      continue;
    }

    load[row.assigned_to].total+=
      points;

    if(
      new Date(row.created_at).getTime()>=cutoff
    ){
      load[row.assigned_to].recent+=
        points;
    }
  }


  /*
     Gesamtbelastung:
     langfristig + stärker gewichtete
     aktuelle Belastung.
  */
  const score=person=>
    load[person].total+
    1.5*load[person].recent;


  const louisaScore=
    score("Louisa");

  const patrickScore=
    score("Patrick");


  /*
     Je niedriger die Belastung,
     desto größer die Wahrscheinlichkeit.

     Dadurch bleibt ein gewisser Zufall
     erhalten und es wird nicht stumpf
     abgewechselt.
  */
  const louisaWeight=
    1/(1+louisaScore);

  const patrickWeight=
    1/(1+patrickScore);

  const assigned=
    Math.random()<
    louisaWeight/
    (louisaWeight+patrickWeight)
      ?"Louisa"
      :"Patrick";


  /*
     ON CONFLICT verhindert,
     dass bei zwei gleichzeitigen
     Anfragen doppelt angelegt wird.
  */
  await pool.query(
    `
    INSERT INTO assignments
      (task_id,period,assigned_to)
    VALUES
      ($1,$2,$3)
    ON CONFLICT(task_id,period)
    DO NOTHING
    `,
    [
      task.id,
      period,
      assigned
    ]
  );


  /*
     Nach dem INSERT nochmals lesen.
     Damit bekommen beide Geräte
     garantiert dieselbe Zuteilung.
  */
  const final=
    await pool.query(
      `
      SELECT assigned_to
      FROM assignments
      WHERE task_id=$1
      AND period=$2
      `,
      [
        task.id,
        period
      ]
    );


  return final.rows[0]?.assigned_to||assigned;
}


/* =========================
   AUTOMATISCHE ZUTEILUNG
========================= */

async function ensureRecurringAssignments(){

  const data=tasks();

  const ps=periods();

  const recurring=
    data.filter(
      task=>
        !task.shared &&
        (
          task.frequency==="weekly"||
          task.frequency==="biweekly"
        )
    );


  for(const task of recurring){

    if(
      task.frequency==="weekly"
    ){

      await fairnessAssign(
        task,
        ps.week
      );
    }


    if(
      task.frequency==="biweekly" &&
      ps.biweeklyActive
    ){

      await fairnessAssign(
        task,
        ps.biweekly
      );
    }
  }


  return ps;
}


/* =========================
   DATENBANK
========================= */

async function init(){

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users(
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions(
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assignments(
      task_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      assigned_to TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
        DEFAULT now(),
      PRIMARY KEY(task_id,period)
    );

    CREATE TABLE IF NOT EXISTS completions(
      task_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      completed_by TEXT NOT NULL,
      completed_at TIMESTAMPTZ NOT NULL
        DEFAULT now(),
      PRIMARY KEY(task_id,period)
    );
  `);


  const count=
    (
      await pool.query(
        "SELECT count(*)::int n FROM users"
      )
    ).rows[0].n;


  if(!count){

    const louisaPassword=
      process.env.LOUISA_PASSWORD;

    const patrickPassword=
      process.env.PATRICK_PASSWORD;


    if(
      !louisaPassword||
      !patrickPassword
    ){

      throw Error(
        "LOUISA_PASSWORD und PATRICK_PASSWORD müssen gesetzt sein."
      );
    }


    await pool.query(
      `
      INSERT INTO users
        (username,password_hash,display_name)
      VALUES
        ($1,$2,$3),
        ($4,$5,$6)
      `,
      [
        "louisa",
        await bcrypt.hash(
          louisaPassword,
          12
        ),
        "Louisa",

        "patrick",
        await bcrypt.hash(
          patrickPassword,
          12
        ),
        "Patrick"
      ]
    );
  }
}


/* =========================
   AUTHENTIFIZIERUNG
========================= */

async function auth(req,res,next){

  try{

    const cookie=
      (req.headers.cookie||"")
        .match(
          /(?:^|;\s*)ht_session=([^;]+)/
        );


    if(!cookie){

      return res.status(401).json({
        error:"Nicht angemeldet"
      });
    }


    const result=
      await pool.query(
        `
        SELECT
          u.id,
          u.username,
          u.display_name
        FROM sessions s
        JOIN users u
          ON u.id=s.user_id
        WHERE
          s.token_hash=$1
          AND s.expires_at>now()
        `,
        [
          hashToken(
            decodeURIComponent(
              cookie[1]
            )
          )
        ]
      );


    if(!result.rowCount){

      return res.status(401).json({
        error:"Sitzung abgelaufen"
      });
    }


    req.user=
      result.rows[0];

    next();

  }catch(error){

    next(error);
  }
}


/* =========================
   LOGIN
========================= */

app.post(
  "/api/login",
  async(req,res,next)=>{

    try{

      const {
        username,
        password
      }=req.body||{};


      const result=
        await pool.query(
          `
          SELECT *
          FROM users
          WHERE username=$1
          `,
          [
            String(
              username||""
            ).toLowerCase()
          ]
        );


      if(
        !result.rowCount||
        !await bcrypt.compare(
          String(password||""),
          result.rows[0].password_hash
        )
      ){

        return res.status(401).json({
          error:
            "Benutzername oder Passwort falsch"
        });
      }


      const token=
        crypto.randomBytes(32)
          .toString("base64url");


      await pool.query(
        `
        INSERT INTO sessions
          (token_hash,user_id,expires_at)
        VALUES
          ($1,$2,now()+interval '30 days')
        `,
        [
          hashToken(token),
          result.rows[0].id
        ]
      );


      res.setHeader(
        "Set-Cookie",
        `ht_session=${encodeURIComponent(token)}; ${cookieOpts()}`
      );


      res.json({
        user:{
          username:
            result.rows[0].username,

          displayName:
            result.rows[0].display_name
        }
      });

    }catch(error){

      next(error);
    }
  }
);


/* =========================
   LOGOUT
========================= */

app.post(
  "/api/logout",
  auth,
  async(req,res,next)=>{

    try{

      const cookie=
        (req.headers.cookie||"")
          .match(
            /(?:^|;\s*)ht_session=([^;]+)/
          );


      if(cookie){

        await pool.query(
          `
          DELETE FROM sessions
          WHERE token_hash=$1
          `,
          [
            hashToken(
              decodeURIComponent(
                cookie[1]
              )
            )
          ]
        );
      }


      res.setHeader(
        "Set-Cookie",
        "ht_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"
      );


      res.json({
        ok:true
      });

    }catch(error){

      next(error);
    }
  }
);


/* =========================
   AKTUELLER USER
========================= */

app.get(
  "/api/me",
  auth,
  (req,res)=>{

    res.json({
      user:{
        username:
          req.user.username,

        displayName:
          req.user.display_name
      }
    });
  }
);


/* =========================
   GESAMTER APP-STATE
========================= */

app.get(
  "/api/state",
  auth,
  async(req,res,next)=>{

    try{

      /*
         Hier werden fehlende
         regelmäßige Aufgaben automatisch
         erzeugt.
      */
      const ps=
        await ensureRecurringAssignments();


      const [
        assignments,
        completions
      ]=
        await Promise.all([

          pool.query(
            `
            SELECT
              task_id,
              period,
              assigned_to
            FROM assignments
            `
          ),

          pool.query(
            `
            SELECT
              task_id,
              period,
              completed_by,
              completed_at
            FROM completions
            `
          )
        ]);


      res.json({

        assignments:
          assignments.rows,

        completions:
          completions.rows,

        periods:ps

      });

    }catch(error){

      next(error);
    }
  }
);


/* =========================
   MANUELLE ZUTEILUNG
   Für Monats-Tasse
========================= */

app.post(
  "/api/assign",
  auth,
  async(req,res,next)=>{

    try{

      const {
        taskId,
        period,
        assignedTo
      }=req.body||{};


      if(
        !Number.isInteger(taskId)||
        !period||
        ![
          "Louisa",
          "Patrick",
          "shared"
        ].includes(assignedTo)
      ){

        return res.status(400).json({
          error:"Ungültige Zuteilung"
        });
      }


      await pool.query(
        `
        INSERT INTO assignments
          (task_id,period,assigned_to)
        VALUES
          ($1,$2,$3)
        ON CONFLICT(task_id,period)
        DO UPDATE SET
          assigned_to=excluded.assigned_to
        `,
        [
          taskId,
          period,
          assignedTo
        ]
      );


      res.json({
        ok:true
      });

    }catch(error){

      next(error);
    }
  }
);


/* =========================
   AUFGABE ABHAKEN
========================= */

app.post(
  "/api/complete",
  auth,
  async(req,res,next)=>{

    try{

      const {
        taskId,
        period
      }=req.body||{};


      if(
        !Number.isInteger(taskId)||
        !period
      ){

        return res.status(400).json({
          error:"Ungültige Aufgabe"
        });
      }


      /*
         Prüfen, ob die Aufgabe
         überhaupt zugeteilt wurde.
      */
      const assignment=
        await pool.query(
          `
          SELECT assigned_to
          FROM assignments
          WHERE task_id=$1
          AND period=$2
          `,
          [
            taskId,
            period
          ]
        );


      if(!assignment.rowCount){

        return res.status(400).json({
          error:
            "Aufgabe wurde noch nicht zugeteilt."
        });
      }


      /*
         Erledigung speichern.
         Beide dürfen den Haken setzen,
         weil beide die gemeinsamen
         Haushaltsaufgaben verwalten.
      */
      await pool.query(
        `
        INSERT INTO completions
          (task_id,period,completed_by)
        VALUES
          ($1,$2,$3)
        ON CONFLICT(task_id,period)
        DO NOTHING
        `,
        [
          taskId,
          period,
          req.user.display_name
        ]
      );


      res.json({
        ok:true
      });

    }catch(error){

      next(error);
    }
  }
);


/* =========================
   STATISCHE DATEIEN
========================= */

app.use(
  express.static(
    path.join(
      __dirname,
      "public"
    )
  )
);


app.get(
  "/{*splat}",
  (req,res)=>{

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);


/* =========================
   FEHLER
========================= */

app.use(
  (error,req,res,next)=>{

    console.error(error);

    if(!res.headersSent){

      res.status(500).json({
        error:"Interner Serverfehler"
      });
    }
  }
);


/* =========================
   SERVER START
========================= */

const port=
  process.env.PORT||8080;


init()
  .then(()=>{

    app.listen(
      port,
      "0.0.0.0",
      ()=>console.log(
        "HaushaltsTasse listening on",
        port
      )
    );
  })
  .catch(error=>{

    console.error(error);

    process.exit(1);
  });