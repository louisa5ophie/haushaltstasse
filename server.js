const express=require("express");
const path=require("path");
const crypto=require("crypto");
const fs=require("fs");
const bcrypt=require("bcryptjs");
const {Pool}=require("pg");

const app=express();
app.use(express.json({limit:"1mb"}));
app.use(express.urlencoded({extended:false}));

const pool=new Pool({connectionString:process.env.DATABASE_URL});
const SESSION_DAYS=30;
const TZ="Europe/Berlin";
const BIWEEKLY_ANCHOR="2026-10-05";

function cookieOpts(){return `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS*86400}`;}
function hashToken(t){return crypto.createHash("sha256").update(t).digest("hex");}
function tasks(){return JSON.parse(fs.readFileSync(path.join(__dirname,"public","data.json"),"utf8")).tasks;}

function berlinParts(d=new Date()){
  const a=new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);
  const o={}; for(const x of a)if(x.type!=="literal")o[x.type]=Number(x.value); return o;
}

function isoWeek(y,m,d){
  const dt=new Date(Date.UTC(y,m-1,d));
  const wd=(dt.getUTCDay()+6)%7;
  const mon=new Date(dt); mon.setUTCDate(dt.getUTCDate()-wd);
  const thu=new Date(mon); thu.setUTCDate(mon.getUTCDate()+3);
  const wy=thu.getUTCFullYear();
  const jan4=new Date(Date.UTC(wy,0,4));
  const jwd=(jan4.getUTCDay()+6)%7;
  const first=new Date(jan4); first.setUTCDate(jan4.getUTCDate()-jwd);
  const w=Math.round((mon-first)/604800000)+1;
  return {year:wy,week:w,key:`${wy}-W${String(w).padStart(2,"0")}`,monday:mon};
}

function periods(){
  const d=berlinParts(), w=isoWeek(d.year,d.month,d.day);
  const anchor=new Date(`${BIWEEKLY_ANCHOR}T00:00:00Z`);
  const diff=Math.round((w.monday-anchor)/604800000);
  const active=diff>=0 && diff%2===0;

  return {
    week:`weekly:${w.key}`,
    weekLabel:w.key,
    biweeklyActive:active,
    biweekly:active?`biweekly:${w.key}`:null
  };
}

async function fairnessAssign(task,period){
  const exists=await pool.query(
    "SELECT assigned_to FROM assignments WHERE task_id=$1 AND period=$2",
    [task.id,period]
  );

  if(exists.rowCount)return exists.rows[0].assigned_to;

  const hist=await pool.query(
    "SELECT task_id,assigned_to,created_at FROM assignments WHERE assigned_to IN ('Louisa','Patrick')"
  );

  const allTasks=tasks();
  const load={
    Louisa:{total:0,recent:0},
    Patrick:{total:0,recent:0}
  };

  const cutoff=Date.now()-42*86400000;

  for(const r of hist.rows){
    const t=allTasks.find(x=>x.id===Number(r.task_id));

    if(!t||t.shared)continue;

    const p=Number(t.points)||0;

    load[r.assigned_to].total+=p;

    if(new Date(r.created_at).getTime()>=cutoff){
      load[r.assigned_to].recent+=p;
    }
  }

  // Niedrigere Belastung bekommt eine höhere Wahrscheinlichkeit.
  // Bei ähnlicher Belastung bleibt Zufall erhalten.
  const score=n=>load[n].total+1.5*load[n].recent;

  const l=score("Louisa");
  const p=score("Patrick");

  const wL=1/(1+l);
  const wP=1/(1+p);

  const assigned=
    Math.random()<(wL/(wL+wP))
      ?"Louisa"
      :"Patrick";

  await pool.query(
    "INSERT INTO assignments(task_id,period,assigned_to) VALUES($1,$2,$3) ON CONFLICT(task_id,period) DO NOTHING",
    [task.id,period,assigned]
  );

  return assigned;
}

async function ensureRecurringAssignments(){
  const data=tasks();
  const ps=periods();

  const regular=data.filter(
    t=>!t.shared &&
    (t.frequency==="weekly"||t.frequency==="biweekly")
  );

  for(const t of regular){

    if(t.frequency==="weekly"){
      await fairnessAssign(t,ps.week);
    }

    if(
      t.frequency==="biweekly" &&
      ps.biweeklyActive
    ){
      await fairnessAssign(t,ps.biweekly);
    }
  }

  return ps;
}

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
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assignments(
      task_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      assigned_to TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(task_id,period)
    );

    CREATE TABLE IF NOT EXISTS completions(
      task_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      completed_by TEXT NOT NULL,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(task_id,period)
    );
  `);

  const n=(await pool.query(
    "SELECT count(*)::int n FROM users"
  )).rows[0].n;

  if(!n){

    const lp=process.env.LOUISA_PASSWORD;
    const pp=process.env.PATRICK_PASSWORD;

    if(!lp||!pp){
      throw Error(
        "Set LOUISA_PASSWORD and PATRICK_PASSWORD before first start."
      );
    }

    await pool.query(
      "INSERT INTO users(username,password_hash,display_name) VALUES($1,$2,$3),($4,$5,$6)",
      [
        "louisa",
        await bcrypt.hash(lp,12),
        "Louisa",
        "patrick",
        await bcrypt.hash(pp,12),
        "Patrick"
      ]
    );
  }
}

async function auth(req,res,next){

  try{

    const m=(req.headers.cookie||"").match(
      /(?:^|;\s*)ht_session=([^;]+)/
    );

    if(!m){
      return res.status(401).json({
        error:"Nicht angemeldet"
      });
    }

    const r=await pool.query(
      `SELECT u.id,u.username,u.display_name
       FROM sessions s
       JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1
       AND s.expires_at>now()`,
      [
        hashToken(
          decodeURIComponent(m[1])
        )
      ]
    );

    if(!r.rowCount){
      return res.status(401).json({
        error:"Sitzung abgelaufen"
      });
    }

    req.user=r.rows[0];

    next();

  }catch(e){
    next(e);
  }
}

app.post("/api/login",async(req,res,next)=>{

  try{

    const {username,password}=req.body||{};

    const r=await pool.query(
      "SELECT * FROM users WHERE username=$1",
      [String(username||"").toLowerCase()]
    );

    if(
      !r.rowCount ||
      !(await bcrypt.compare(
        String(password||""),
        r.rows[0].password_hash
      ))
    ){
      return res.status(401).json({
        error:"Benutzername oder Passwort falsch"
      });
    }

    const token=
      crypto.randomBytes(32).toString("base64url");

    await pool.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')",
      [
        hashToken(token),
        r.rows[0].id
      ]
    );

    res.setHeader(
      "Set-Cookie",
      `ht_session=${encodeURIComponent(token)}; ${cookieOpts()}`
    );

    res.json({
      user:{
        username:r.rows[0].username,
        displayName:r.rows[0].display_name
      }
    });

  }catch(e){
    next(e);
  }
});

app.post("/api/logout",auth,async(req,res,next)=>{

  try{

    const m=(req.headers.cookie||"").match(
      /(?:^|;\s*)ht_session=([^;]+)/
    );

    if(m){
      await pool.query(
        "DELETE FROM sessions WHERE token_hash=$1",
        [
          hashToken(
            decodeURIComponent(m[1])
          )
        ]
      );
    }

    res.setHeader(
      "Set-Cookie",
      "ht_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"
    );

    res.json({ok:true});

  }catch(e){
    next(e);
  }
});

app.get(
  "/api/me",
  auth,
  (req,res)=>res.json({
    user:{
      username:req.user.username,
      displayName:req.user.display_name
    }
  })
);

app.get("/api/state",auth,async(req,res,next)=>{

  try{

    const ps=await ensureRecurringAssignments();

    const [a,c]=await Promise.all([

      pool.query(
        "SELECT task_id,period,assigned_to FROM assignments"
      ),

      pool.query(
        "SELECT task_id,period,completed_by,completed_at FROM completions"
      )

    ]);

    res.json({
      assignments:a.rows,
      completions:c.rows,
      periods:ps
    });

  }catch(e){
    next(e);
  }
});

app.post("/api/assign",auth,async(req,res,next)=>{

  try{

    const {taskId,period,assignedTo}=req.body||{};

    if(
      !Number.isInteger(taskId) ||
      !period ||
      !["Louisa","Patrick","shared"].includes(assignedTo)
    ){
      return res.status(400).json({
        error:"Ungültige Zuteilung"
      });
    }

    await pool.query(
      `INSERT INTO assignments
       (task_id,period,assigned_to)
       VALUES($1,$2,$3)
       ON CONFLICT(task_id,period)
       DO UPDATE SET assigned_to=excluded.assigned_to`,
      [
        taskId,
        period,
        assignedTo
      ]
    );

    res.json({ok:true});

  }catch(e){
    next(e);
  }
});

app.post("/api/complete",auth,async(req,res,next)=>{

  try{

    const {taskId,period}=req.body||{};

    if(
      !Number.isInteger(taskId) ||
      !period
    ){
      return res.status(400).json({
        error:"Ungültige Aufgabe"
      });
    }

    const a=await pool.query(
      "SELECT assigned_to FROM assignments WHERE task_id=$1 AND period=$2",
      [
        taskId,
        period
      ]
    );

    if(!a.rowCount){
      return res.status(400).json({
        error:"Aufgabe wurde noch nicht zugeteilt"
      });
    }

    await pool.query(
      `INSERT INTO completions
       (task_id,period,completed_by)
       VALUES($1,$2,$3)
       ON CONFLICT(task_id,period)
       DO NOTHING`,
      [
        taskId,
        period,
        req.user.display_name
      ]
    );

    res.json({ok:true});

  }catch(e){
    next(e);
  }
});

app.use(
  express.static(
    path.join(__dirname,"public")
  )
);

app.get(
  "/{*splat}",
  (req,res)=>res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  )
);

app.use((err,req,res,next)=>{

  console.error(err);

  if(!res.headersSent){
    res.status(500).json({
      error:"Interner Serverfehler"
    });
  }

});

const port=process.env.PORT||8080;

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
  .catch(e=>{
    console.error(e);
    process.exit(1);
  });