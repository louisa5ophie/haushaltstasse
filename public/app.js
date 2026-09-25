let DATA={
  tasks:[],
  months:{}
};

let STATE={
  me:null,
  assignments:{},
  completions:{},
  periods:{}
};

let tab="week";
let filter="all";
let month="2026-10";

const $=s=>document.querySelector(s);


/* =========================
   API
========================= */

async function api(url,opt={}){

  const r=await fetch(
    url,
    {
      ...opt,
      headers:{
        "Content-Type":"application/json",
        ...(opt.headers||{})
      }
    }
  );

  const text=await r.text();

  let j;

  try{
    j=JSON.parse(text);
  }catch(e){
    throw Error(
      "Serverantwort ist kein gültiges JSON ("+
      r.status+"): "+
      text.slice(0,150)
    );
  }

  if(!r.ok){
    throw Error(
      j.error||"HTTP "+r.status
    );
  }

  return j;
}


/* =========================
   ZEITRÄUME
========================= */

function isoWeek(date){

  const d=new Date(
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    )
  );

  const day=d.getUTCDay()||7;

  d.setUTCDate(
    d.getUTCDate()+4-day
  );

  const yearStart=
    new Date(
      Date.UTC(
        d.getUTCFullYear(),
        0,
        1
      )
    );

  const week=
    Math.ceil(
      (
        (
          (d-yearStart)/86400000
        )+1
      )/7
    );

  return {
    year:d.getUTCFullYear(),
    week,
    key:
      `${d.getUTCFullYear()}-W${String(week).padStart(2,"0")}`
  };
}


function getPeriods(){

  const now=new Date();

  const w=isoWeek(now);

  const anchor=
    new Date("2026-10-05T00:00:00");

  const monday=
    new Date(now);

  const day=
    monday.getDay()||7;

  monday.setHours(0,0,0,0);
  monday.setDate(
    monday.getDate()-(day-1)
  );

  const diffWeeks=
    Math.round(
      (
        monday-anchor
      )/
      (7*24*60*60*1000)
    );

  return {

    week:
      "weekly:"+w.key,

    weekLabel:
      w.key,

    biweeklyActive:
      diffWeeks>=0 &&
      diffWeeks%2===0,

    biweekly:
      diffWeeks>=0 &&
      diffWeeks%2===0
        ?"biweekly:"+w.key
        :null
  };
}


/* =========================
   STATE
========================= */

async function loadState(){

  const s=
    await api("/api/state");

  STATE.assignments=
    Object.fromEntries(
      (s.assignments||[]).map(x=>[
        x.task_id+"@"+x.period,
        x.assigned_to
      ])
    );

  STATE.completions=
    Object.fromEntries(
      (s.completions||[]).map(x=>[
        x.task_id+"@"+x.period,
        x.completed_at
      ])
    );

  STATE.periods=
    s.periods||getPeriods();
}


/* =========================
   AUTOMATISCHE ZUTEILUNG
========================= */

async function ensureWeeklyAssignments(){

  const periods=
    STATE.periods;

  const recurring=
    DATA.tasks.filter(
      x=>
        !x.shared &&
        (
          x.frequency==="weekly" ||
          x.frequency==="biweekly"
        )
    );

  const jobs=[];

  for(const task of recurring){

    let period=null;

    if(task.frequency==="weekly"){
      period=periods.week;
    }

    if(
      task.frequency==="biweekly" &&
      periods.biweeklyActive
    ){
      period=periods.biweekly;
    }

    if(!period)continue;

    const key=
      task.id+"@"+period;

    if(
      STATE.assignments[key]
    ){
      continue;
    }

    jobs.push({
      task,
      period
    });
  }

  if(!jobs.length){
    return;
  }


  /*
     Belastung anhand der bereits
     vorhandenen Zuteilungen.

     Aufwandspunkte zählen,
     nicht Anzahl der Aufgaben.
  */

  const load={
    Louisa:0,
    Patrick:0
  };

  for(const assignment of Object.entries(
    STATE.assignments
  )){

    const assigned=assignment[1];

    if(
      assigned!=="Louisa" &&
      assigned!=="Patrick"
    ){
      continue;
    }

    const taskId=
      Number(
        assignment[0]
          .split("@")[0]
      );

    const task=
      DATA.tasks.find(
        x=>x.id===taskId
      );

    if(task){
      load[assigned]+=
        Number(task.points)||0;
    }
  }


  /*
     Aufgaben einzeln verteilen.
     Wer bisher weniger Punkte hat,
     bekommt eine höhere Chance.
     Bei gleichem Stand entscheidet
     der Zufall.
  */

  for(const job of jobs){

    const l=load.Louisa;
    const p=load.Patrick;

    let assigned;

    if(l===p){

      assigned=
        Math.random()<0.5
          ?"Louisa"
          :"Patrick";

    }else if(l<p){

      assigned=
        Math.random()<0.75
          ?"Louisa"
          :"Patrick";

    }else{

      assigned=
        Math.random()<0.75
          ?"Patrick"
          :"Louisa";
    }


    await api(
      "/api/assign",
      {
        method:"POST",
        body:JSON.stringify({
          taskId:job.task.id,
          period:job.period,
          assignedTo:assigned
        })
      }
    );

    STATE.assignments[
      job.task.id+"@"+job.period
    ]=assigned;

    load[assigned]+=
      Number(job.task.points)||0;
  }
}


/* =========================
   START
========================= */

async function boot(){

  DATA=
    await(
      await fetch(
        "/data.json?v=20260925"
      )
    ).json();

  const m=
    await api("/api/me");

  if(m?.user){

    STATE.me=m.user;

    await loadState();

    /*
       Falls der Server die Zeiträume
       nicht liefert, erzeugen wir sie
       hier selbst.
    */
    if(!STATE.periods.week){
      STATE.periods=
        getPeriods();
    }

    await ensureWeeklyAssignments();

    render();

  }else{

    login();
  }
}


/* =========================
   LOGIN
========================= */

function login(){

  document.body.innerHTML=`

    <main
      style="
        max-width:420px;
        margin:12vh auto;
        padding:20px
      "
    >

      <div class="card">

        <div class="eyebrow">
          HAUSHALTSTASSE
        </div>

        <h1>
          Anmelden
        </h1>

        <p class="muted">
          Nur Louisa und Patrick haben Zugang.
        </p>

        <form id="lf">

          <div class="field">

            <label>
              Benutzer
            </label>

            <select id="u">

              <option value="louisa">
                Louisa
              </option>

              <option value="patrick">
                Patrick
              </option>

            </select>

          </div>

          <div class="field">

            <label>
              Passwort
            </label>

            <input
              id="p"
              type="password"
              autocomplete="current-password"
              required
            >

          </div>

          <button class="drawbtn">
            Und los!
          </button>

          <p
            id="err"
            class="overdue"
          ></p>

        </form>

      </div>

    </main>
  `;


  $("#lf").onsubmit=async e=>{

    e.preventDefault();

    try{

      await api(
        "/api/login",
        {
          method:"POST",
          body:JSON.stringify({
            username:$("#u").value,
            password:$("#p").value
          })
        }
      );

      const m=
        await api("/api/me");

      STATE.me=m.user;

      await loadState();

      if(!STATE.periods.week){
        STATE.periods=
          getPeriods();
      }

      await ensureWeeklyAssignments();

      render();

    }catch(x){

      $("#err").textContent=
        x.message;
    }
  };
}


/* =========================
   HILFSFUNKTIONEN
========================= */

function t(id){

  return DATA.tasks.find(
    x=>x.id===id
  );
}


function ml(k){

  let[y,m]=k
    .split("-")
    .map(Number);

  return new Intl.DateTimeFormat(
    "de-DE",
    {
      month:"long",
      year:"numeric"
    }
  ).format(
    new Date(y,m-1,1)
  );
}


function al(id,p){

  if(!p)return "";

  return STATE.assignments[
    id+"@"+p
  ]||"";
}


function done(id,p){

  if(!p)return false;

  return !!STATE.completions[
    id+"@"+p
  ];
}


/* =========================
   AUFGABENZEILE
========================= */

function row(x,p){

  const assigned=
    al(x.id,p);

  const completed=
    done(x.id,p);

  return `

    <div class="taskrow">

      <button
        class="check ${completed?"done":""}"
        onclick="complete(${x.id},'${p}')"
        ${completed?"disabled":""}
      >
        ${completed?"✓":""}
      </button>

      <div
        class="taskname ${completed?"completed":""}"
      >

        ${x.name}

        <div class="meta">

          ${
            assigned
              ?assigned+" · "
              :"Noch nicht zugeteilt · "
          }

          ${x.points}
          Punkte

          ${
            x.shared
              ?" · gemeinsam"
              :""
          }

        </div>

      </div>

      <span class="points">
        ${x.points} P
      </span>

    </div>
  `;
}


/* =========================
   HAUPTANSICHT
========================= */

function render(){

  document.body.innerHTML=`

    <header class="topbar">

      <div>

        <div class="eyebrow">
          HAUSHALTSTASSE
        </div>

        <h1>

          ${
            tab==="week"
              ?"Diese Woche"
              :tab==="cup"
              ?"Cup"
              :tab==="tasks"
              ?"Aufgaben"
              :"Historie"
          }

        </h1>

      </div>

      <button
        class="iconbtn"
        onclick="logout()"
      >
        ↪
      </button>

    </header>

    <main id="c"></main>

    <nav class="tabbar">

      ${
        [
          ["week","🗓️","Diese Woche"],
          ["cup","☕️","Cup"],
          ["tasks","☑️","Aufgaben"],
          ["history","🎍","Historie"]
        ]
        .map(a=>`

          <button
            class="tab ${tab===a[0]?"active":""}"
            onclick="tab='${a[0]}';render()"
          >

            ${a[1]}

            <span>
              ${a[2]}
            </span>

          </button>

        `)
        .join("")
      }

    </nav>
  `;

  ({
    week,
    cup,
    tasks,
    history
  }[tab])();
}


/* =========================
   DIESE WOCHE
========================= */

function week(){

  const items=[];


  /*
     Wöchentliche Aufgaben
  */

  DATA.tasks
    .filter(
      x=>x.frequency==="weekly"
    )
    .forEach(x=>{

      items.push({
        task:x,
        period:STATE.periods.week
      });

    });


  /*
     Zweiwöchentliche Aufgaben
  */

  if(
    STATE.periods.biweeklyActive
  ){

    DATA.tasks
      .filter(
        x=>x.frequency==="biweekly"
      )
      .forEach(x=>{

        items.push({
          task:x,
          period:STATE.periods.biweekly
        });

      });
  }


  const lp=
    items
      .filter(
        i=>
          al(
            i.task.id,
            i.period
          )==="Louisa"
      )
      .reduce(
        (s,i)=>
          s+i.task.points,
        0
      );


  const pp=
    items
      .filter(
        i=>
          al(
            i.task.id,
            i.period
          )==="Patrick"
      )
      .reduce(
        (s,i)=>
          s+i.task.points,
        0
      );


  $("#c").innerHTML=`

    <div class="hero">

      <div class="muted">
        Angemeldet als
        ${STATE.me.displayName}
      </div>

      <h2>
        Unser Haushaltsplan.✨
      </h2>

      <div class="muted">
        Sperberweg 7
      </div>

      <div
        class="meta"
        style="margin-top:12px"
      >

        Louisa:
        ${lp} P

        ·

        Patrick:
        ${pp} P

      </div>

    </div>

    <div class="sectiontitle">
      Regelmäßige Aufgaben
    </div>

    <div class="card">

      ${
        items.length

          ?items
            .map(
              i=>
                row(
                  i.task,
                  i.period
                )
            )
            .join("")

          :`
            <div class="empty">
              Keine regelmäßigen Aufgaben.
            </div>
          `
      }

    </div>
  `;
}


/* =========================
   MONATS-TASSE
========================= */

function cup(){

  const ids=
    DATA.months[month]||[];

  const rem=
    ids.filter(
      id=>!al(id,month)
    );

  const drawn=
    ids.filter(
      id=>al(id,month)
    );

  const person=
    drawn.filter(
      id=>!t(id).shared
    ).length%2===0
      ?"Louisa"
      :"Patrick";


  $("#c").innerHTML=`

    <div class="card">

      <div class="monthnav">

        <button
          onclick="shift(-1)"
        >
          ‹
        </button>

        <div>

          <b>
            ${ml(month)}
          </b>

          <div class="muted">

            ${ids.length}
            Aufgaben ·

            ${rem.length}
            offen

          </div>

        </div>

        <button
          onclick="shift(1)"
        >
          ›
        </button>

      </div>

      <div class="cup">

        <div class="cupshape"></div>

      </div>

      <button
        class="drawbtn"
        onclick="draw()"
        ${rem.length?"":"disabled"}
      >

        ${
          rem.length
            ?person+" zieht"
            :"Tasse ist leer"
        }

      </button>

    </div>


    ${
      drawn.length

        ?`

          <div class="sectiontitle">
            Gezogen
          </div>

          <div class="card">

            ${
              drawn
                .map(id=>`

                  <div class="drawn">

                    <strong>
                      ${t(id).name}
                    </strong>

                    <div class="meta">

                      ${al(id,month)}
                      ·
                      ${t(id).points}
                      Punkte

                    </div>

                  </div>

                `)
                .join("")
            }

          </div>

        `

        :""
    }


    <div class="sectiontitle">
      Noch in der Tasse
    </div>

    <div class="card">

      ${
        rem
          .map(id=>`

            <div class="taskrow">

              <div class="taskname">

                ${t(id).name}

                <div class="meta">
                  ${t(id).points}
                  Punkte
                </div>

              </div>

            </div>

          `)
          .join("")
      }

    </div>
  `;
}


/* =========================
   MONAT WECHSELN
========================= */

function shift(d){

  let[y,m]=month
    .split("-")
    .map(Number);

  m+=d;

  if(m<1){
    m=12;
    y--;
  }

  if(m>12){
    m=1;
    y++;
  }

  month=
    `${y}-${String(m).padStart(2,"0")}`;

  render();
}


/* =========================
   TASSE ZIEHEN
========================= */

async function draw(){

  const ids=
    (DATA.months[month]||[])
      .filter(
        id=>!al(id,month)
      );

  if(!ids.length)return;

  const n=
    ids[
      Math.floor(
        Math.random()*ids.length
      )
    ];

  const x=t(n);

  const drawn=
    (DATA.months[month]||[])
      .filter(
        id=>al(id,month)
      ).length;


  await api(
    "/api/assign",
    {
      method:"POST",
      body:JSON.stringify({

        taskId:n,

        period:month,

        assignedTo:
          x.shared
            ?"shared"
            :(drawn%2===0
              ?"Louisa"
              :"Patrick")

      })
    }
  );


  await loadState();

  render();
}


/* =========================
   AUFGABEN
========================= */

function tasks(){

  $("#c").innerHTML=`

    <div class="pillrow">

      ${
        [
          "alle",
          "wöchentlich",
          "zweiwöchentlich",
          "alle zwei Monate",
          "quartalsweise",
          "halbjährlich",
          "jährlich"
        ]

        .map(f=>`

          <button
            class="pill ${filter===f?"active":""}"
            onclick="filter='${f}';render()"
          >

            ${
              f==="all"
                ?"Alle"
                :f
            }

          </button>

        `)
        .join("")
      }

    </div>


    <div class="card">

      ${
        DATA.tasks

          .filter(
            x=>
              filter==="all"||
              x.frequency===filter
          )

          .map(x=>`

            <div class="taskrow">

              <div class="taskname">

                ${x.name}

                <div class="meta">

                  ${x.points}
                  Aufwandspunkte

                  ${
                    x.shared
                      ?" · gemeinsam"
                      :""
                  }

                </div>

              </div>

              <span class="points">
                ${x.points} P
              </span>

            </div>

          `)
          .join("")
      }

    </div>
  `;
}


/* =========================
   ABHAKEN
========================= */

async function complete(id,p){

  if(!p){
    alert(
      "Für diese Aufgabe wurde noch kein Zeitraum festgelegt."
    );
    return;
  }

  try{

    await api(
      "/api/complete",
      {
        method:"POST",
        body:JSON.stringify({
          taskId:id,
          period:p
        })
      }
    );

    await loadState();

    render();

  }catch(e){

    alert(
      e.message
    );
  }
}


/* =========================
   HISTORIE
========================= */

async function history(){

  const s=
    await api("/api/state");

  const rows=
    (s.completions||[])
      .slice()
      .reverse()
      .map(x=>{

        const task=
          t(x.task_id);

        if(!task)return "";

        return `

          <div class="taskrow">

            <div class="taskname">

              ✓
              ${task.name}

              <div class="meta">

                ${x.completed_by}
                ·

                ${
                  new Date(
                    x.completed_at
                  ).toLocaleDateString(
                    "de-DE"
                  )
                }

              </div>

            </div>

            <span class="points">

              ${
                task.shared
                  ?"—"
                  :task.points+" P"
              }

            </span>

          </div>

        `;
      })
      .join("");


  $("#c").innerHTML=`

    <div class="hero">

      <div class="muted">
        Fairness
      </div>

      <h2>
        Historie
      </h2>

      <div class="muted">
        Gemeinsame Aufgaben werden
        nicht doppelt gezählt.
      </div>

    </div>

    <div class="card">

      ${
        rows||
        `
          <div class="empty">
            Noch keine erledigten Aufgaben.
          </div>
        `
      }

    </div>
  `;
}


/* =========================
   LOGOUT
========================= */

async function logout(){

  await api(
    "/api/logout",
    {
      method:"POST"
    }
  );

  location.reload();
}


/* =========================
   START
========================= */

boot().catch(
  e=>{
    console.error(e);
    login();
  }
);