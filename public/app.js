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

async function api(url,opt={}){

  try{

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
        text.slice(0,120)
      );
    }

    if(r.status===401){
      throw Error(
        "Login abgelehnt (HTTP 401)."
      );
    }

    if(!r.ok){
      throw Error(
        j.error||"HTTP "+r.status
      );
    }

    return j;

  }catch(e){

    console.error(
      "API-Fehler:",
      url,
      e
    );

    throw Error(
      "API-Fehler: "+
      (e?.message||String(e))
    );
  }
}

async function loadState(){

  const s=await api("/api/state");

  STATE.assignments=
    Object.fromEntries(
      s.assignments.map(x=>[
        x.task_id+"@"+x.period,
        x.assigned_to
      ])
    );

  STATE.completions=
    Object.fromEntries(
      s.completions.map(x=>[
        x.task_id+"@"+x.period,
        x.completed_at
      ])
    );

  STATE.periods=s.periods||{};
}

async function boot(){

  DATA=
    await(
      await fetch("/data.json")
    ).json();

  const m=await api("/api/me");

  if(m?.user){

    STATE.me=m.user;

    await loadState();

    render();
  }
}

function login(){

  document.body.innerHTML=`

    <main
      style="max-width:420px;margin:12vh auto;padding:20px"
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
            Anmelden
          </button>

          <p
            id="err"
            class="overdue"
          ></p>

        </form>

      </div>

    </main>`;

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

      const m=await api(
        "/api/me"
      );

      if(!m?.user){

        throw Error(
          "Login erfolgreich, aber keine Sitzung gefunden."
        );
      }

      STATE.me=m.user;

      await loadState();

      render();

    }catch(x){

      $("#err").textContent=
        x.message;
    }
  };
}

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
  return STATE.assignments[
    id+"@"+p
  ]||"";
}

function done(id,p){
  return !!STATE.completions[
    id+"@"+p
  ];
}

function row(x,p){

  const assigned=
    al(x.id,p);

  return `

    <div class="taskrow">

      <button
        class="check ${done(x.id,p)?"done":""}"
        onclick="complete(${x.id},'${p}')"
      >
        ${done(x.id,p)?"✓":""}
      </button>

      <div
        class="taskname ${done(x.id,p)?"completed":""}"
      >

        ${x.name}

        <div class="meta">

          ${assigned
            ?assigned+" · "
            :""
          }

          ${x.points}
          Punkte

          ${x.shared
            ?" · gemeinsam"
            :""
          }

        </div>

      </div>

      <span class="points">
        ${x.points} P
      </span>

    </div>`;
}

function render(){

  document.body.innerHTML=`

    <header class="topbar">

      <div>

        <div class="eyebrow">
          HAUSHALTS TASSE
        </div>

        <h1>

          ${
            tab==="week"
            ?"Diese Woche"
            :tab==="cup"
            ?"Monats-Tasse"
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
          ["cup","☕️","Monats-Tasse"],
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

    </nav>`;

  ({
    week,
    cup,
    tasks,
    history
  }[tab])();
}

function week(){

  const items=[

    ...DATA.tasks
      .filter(
        x=>x.frequency==="weekly"
      )
      .map(x=>({
        task:x,
        period:STATE.periods.week
      })),

    ...(STATE.periods.biweeklyActive

      ?DATA.tasks
        .filter(
          x=>x.frequency==="biweekly"
        )
        .map(x=>({
          task:x,
          period:STATE.periods.biweekly
        }))

      :[])

  ];

  const lp=
    items
      .filter(
        i=>al(
          i.task.id,
          i.period
        )==="Louisa"
      )
      .reduce(
        (s,i)=>s+i.task.points,
        0
      );

  const pp=
    items
      .filter(
        i=>al(
          i.task.id,
          i.period
        )==="Patrick"
      )
      .reduce(
        (s,i)=>s+i.task.points,
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
            i=>row(
              i.task,
              i.period
            )
          )
          .join("")

        :'<div class="empty">Keine regelmäßigen Aufgaben.</div>'
      }

    </div>`;
}

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

        <div class="steam">
          ∿ ∿
        </div>

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

    </div>`;
}

function shift(d){

  let[y,m]=month
    .split("-")
    .map(Number);

  m+=d;

  if(m<1){
    m=12;
    y--
  }

  if(m>12){
    m=1;
    y++
  }

  month=
    `${y}-${String(m).padStart(2,"0")}`;

  render();
}

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

function tasks(){

  $("#c").innerHTML=`

    <div class="pillrow">

      ${
        [
          "all",
          "weekly",
          "biweekly",
          "bimonthly",
          "quarterly",
          "semiannual",
          "annual"
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

    </div>`;
}

async function complete(id,p){

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
}

async function history(){

  const s=
    await api("/api/state");

  const rows=
    s.completions
      .slice()
      .reverse()
      .map(x=>`

        <div class="taskrow">

          <div class="taskname">

            ✓
            ${t(x.task_id).name}

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
              t(x.task_id).shared
              ?"—"
              :t(x.task_id).points+" P"
            }

          </span>

        </div>

      `)
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
        rows ||
        '<div class="empty">Noch keine erledigten Aufgaben.</div>'
      }

    </div>`;
}

async function logout(){

  await api(
    "/api/logout",
    {
      method:"POST"
    }
  );

  location.reload();
}

boot().catch(
  ()=>login()
);