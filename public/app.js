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

  const response=
    await fetch(
      url,
      {
        ...opt,
        headers:{
          "Content-Type":
            "application/json",
          ...(opt.headers||{})
        }
      }
    );


  const text=
    await response.text();


  let data;

  try{

    data=
      JSON.parse(text);

  }catch(error){

    throw Error(
      "Serverantwort ist kein gültiges JSON ("+
      response.status+
      "): "+
      text.slice(0,150)
    );
  }


  if(!response.ok){

    throw Error(
      data.error||
      "HTTP "+response.status
    );
  }


  return data;
}


/* =========================
   STATE LADEN
========================= */

async function loadState(){

  const data=
    await api("/api/state");


  STATE.assignments=
    Object.fromEntries(
      (data.assignments||[])
        .map(item=>[
          item.task_id+
          "@"+
          item.period,
          item.assigned_to
        ])
    );


  STATE.completions=
    Object.fromEntries(
      (data.completions||[])
        .map(item=>[
          item.task_id+
          "@"+
          item.period,
          item.completed_at
        ])
    );


  STATE.periods=
    data.periods||{};
}


/* =========================
   APP START
========================= */

async function boot(){

  DATA=
    await(
      await fetch(
        "/data.json?v=202609252030"
      )
    ).json();


  const me=
    await api("/api/me");


  if(me?.user){

    STATE.me=
      me.user;

    await loadState();

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

          <button
            class="drawbtn"
            type="submit"
          >
            Anmelden
          </button>

          <p
            id="err"
            class="overdue"
          ></p>

        </form>

      </div>

    </main>
  `;


  $("#lf").onsubmit=
    async event=>{

      event.preventDefault();


      try{

        await api(
          "/api/login",
          {
            method:"POST",
            body:JSON.stringify({
              username:
                $("#u").value,

              password:
                $("#p").value
            })
          }
        );


        const me=
          await api("/api/me");


        STATE.me=
          me.user;


        await loadState();

        render();

      }catch(error){

        $("#err").textContent=
          error.message;
      }
    };
}


/* =========================
   HILFSFUNKTIONEN
========================= */

function task(id){

  return DATA.tasks.find(
    item=>item.id===id
  );
}


function monthLabel(key){

  const [
    year,
    monthNumber
  ]=
    key
      .split("-")
      .map(Number);


  return new Intl.DateTimeFormat(
    "de-DE",
    {
      month:"long",
      year:"numeric"
    }
  ).format(
    new Date(
      year,
      monthNumber-1,
      1
    )
  );
}


function assignedTo(
  taskId,
  period
){

  if(!period){
    return "";
  }

  return STATE.assignments[
    taskId+"@"+period
  ]||"";
}


function isDone(
  taskId,
  period
){

  if(!period){
    return false;
  }

  return !!STATE.completions[
    taskId+"@"+period
  ];
}


/* =========================
   AUFGABENZEILE
========================= */

function taskRow(
  item,
  period
){

  const assigned=
    assignedTo(
      item.id,
      period
    );


  const completed=
    isDone(
      item.id,
      period
    );


  return `

    <div class="taskrow">

      <button
        class="check ${
          completed
            ?"done"
            :""
        }"
        onclick="completeTask(
          ${item.id},
          '${period}'
        )"
        ${
          completed
            ?"disabled"
            :""
        }
      >

        ${
          completed
            ?"✓"
            :""
        }

      </button>


      <div
        class="
          taskname
          ${
            completed
              ?"completed"
              :""
          }
        "
      >

        ${item.name}

        <div class="meta">

          ${
            assigned
              ?assigned+" · "
              :""
          }

          ${item.points}
          Punkte

          ${
            item.shared
              ?" · gemeinsam"
              :""
          }

        </div>

      </div>


      <span class="points">
        ${item.points} P
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
          [
            "week",
            "🗓️",
            "Diese Woche"
          ],
          [
            "cup",
            "☕️",
            "Monats-Tasse"
          ],
          [
            "tasks",
            "☑️",
            "Aufgaben"
          ],
          [
            "history",
            "🎍",
            "Historie"
          ]
        ]
        .map(item=>`

          <button
            class="
              tab
              ${
                tab===item[0]
                  ?"active"
                  :""
              }
            "
            onclick="
              tab='${item[0]}';
              render();
            "
          >

            ${item[1]}

            <span>
              ${item[2]}
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
     Alle wöchentlichen Aufgaben.
  */
  DATA.tasks
    .filter(
      item=>
        item.frequency==="weekly"
    )
    .forEach(item=>{

      items.push({
        task:item,
        period:
          STATE.periods.week
      });

    });


  /*
     Zweiwöchentliche Aufgaben nur
     in den entsprechenden Wochen.
  */
  if(
    STATE.periods.biweeklyActive
  ){

    DATA.tasks
      .filter(
        item=>
          item.frequency==="biweekly"
      )
      .forEach(item=>{

        items.push({
          task:item,
          period:
            STATE.periods.biweekly
        });

      });
  }


  /*
     Aufwand der aktuellen Woche.
  */
  const louisaPoints=
    items
      .filter(
        item=>
          assignedTo(
            item.task.id,
            item.period
          )==="Louisa"
      )
      .reduce(
        (sum,item)=>
          sum+
          Number(
            item.task.points
          ),
        0
      );


  const patrickPoints=
    items
      .filter(
        item=>
          assignedTo(
            item.task.id,
            item.period
          )==="Patrick"
      )
      .reduce(
        (sum,item)=>
          sum+
          Number(
            item.task.points
          ),
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
        ${louisaPoints} P

        ·

        Patrick:
        ${patrickPoints} P

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
              item=>
                taskRow(
                  item.task,
                  item.period
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


  const remaining=
    ids.filter(
      id=>
        !assignedTo(
          id,
          month
        )
    );


  const drawn=
    ids.filter(
      id=>
        assignedTo(
          id,
          month
        )
    );


  const person=
    drawn.filter(
      id=>
        !task(id).shared
    ).length%2===0
      ?"Louisa"
      :"Patrick";


  $("#c").innerHTML=`

    <div class="card">

      <div class="monthnav">

        <button
          onclick="shiftMonth(-1)"
        >
          ‹
        </button>


        <div>

          <b>
            ${monthLabel(month)}
          </b>

          <div class="muted">

            ${ids.length}
            Aufgaben ·

            ${remaining.length}
            offen

          </div>

        </div>


        <button
          onclick="shiftMonth(1)"
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
        onclick="drawTask()"
        ${
          remaining.length
            ?""
            :"disabled"
        }
      >

        ${
          remaining.length
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
                      ${task(id).name}
                    </strong>

                    <div class="meta">

                      ${
                        assignedTo(
                          id,
                          month
                        )
                      }

                      ·

                      ${task(id).points}
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
        remaining
          .map(id=>`

            <div class="taskrow">

              <div class="taskname">

                ${task(id).name}

                <div class="meta">
                  ${task(id).points}
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

function shiftMonth(direction){

  let[
    year,
    monthNumber
  ]=
    month
      .split("-")
      .map(Number);


  monthNumber+=direction;


  if(monthNumber<1){

    monthNumber=12;
    year--;
  }


  if(monthNumber>12){

    monthNumber=1;
    year++;
  }


  month=
    `${year}-${String(
      monthNumber
    ).padStart(2,"0")}`;


  render();
}


/* =========================
   TASSE ZIEHEN
========================= */

async function drawTask(){

  const ids=
    (
      DATA.months[month]||[]
    ).filter(
      id=>
        !assignedTo(
          id,
          month
        )
    );


  if(!ids.length){
    return;
  }


  const id=
    ids[
      Math.floor(
        Math.random()*ids.length
      )
    ];


  const item=
    task(id);


  const alreadyDrawn=
    (
      DATA.months[month]||[]
    ).filter(
      taskId=>
        assignedTo(
          taskId,
          month
        )
    ).length;


  const assigned=
    item.shared
      ?"shared"
      :alreadyDrawn%2===0
        ?"Louisa"
        :"Patrick";


  await api(
    "/api/assign",
    {
      method:"POST",
      body:JSON.stringify({

        taskId:id,

        period:month,

        assignedTo:assigned

      })
    }
  );


  await loadState();

  render();
}


/* =========================
   ALLE AUFGABEN
========================= */

function tasks(){

  const frequencies=[
    "all",
    "weekly",
    "biweekly",
    "bimonthly",
    "quarterly",
    "semiannual",
    "annual"
  ];


  $("#c").innerHTML=`

    <div class="pillrow">

      ${
        frequencies
          .map(f=>`

            <button
              class="
                pill
                ${
                  filter===f
                    ?"active"
                    :""
                }
              "
              onclick="
                filter='${f}';
                render();
              "
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
            item=>
              filter==="all"||
              item.frequency===filter
          )
          .map(item=>`

            <div class="taskrow">

              <div class="taskname">

                ${item.name}

                <div class="meta">

                  ${item.points}
                  Aufwandspunkte

                  ${
                    item.shared
                      ?" · gemeinsam"
                      :""
                  }

                </div>

              </div>


              <span class="points">
                ${item.points} P
              </span>

            </div>

          `)
          .join("")
      }

    </div>
  `;
}


/* =========================
   AUFGABE ABHAKEN
========================= */

async function completeTask(
  taskId,
  period
){

  if(!period){

    alert(
      "Für diese Aufgabe ist kein Zeitraum vorhanden."
    );

    return;
  }


  try{

    await api(
      "/api/complete",
      {
        method:"POST",

        body:JSON.stringify({
          taskId,
          period
        })
      }
    );


    await loadState();

    render();

  }catch(error){

    alert(
      error.message
    );
  }
}


/* =========================
   HISTORIE
========================= */

async function history(){

  const state=
    await api(
      "/api/state"
    );


  const rows=
    (state.completions||[])
      .slice()
      .reverse()
      .map(item=>{

        const currentTask=
          task(item.task_id);


        if(!currentTask){
          return "";
        }


        return `

          <div class="taskrow">

            <div class="taskname">

              ✓
              ${currentTask.name}

              <div class="meta">

                ${item.completed_by}

                ·

                ${
                  new Date(
                    item.completed_at
                  ).toLocaleDateString(
                    "de-DE"
                  )
                }

              </div>

            </div>


            <span class="points">

              ${
                currentTask.shared
                  ?"—"
                  :currentTask.points+
                    " P"
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

  try{

    await api(
      "/api/logout",
      {
        method:"POST"
      }
    );

  }finally{

    location.reload();
  }
}


/* =========================
   STARTEN
========================= */

boot().catch(error=>{

  console.error(
    "Boot-Fehler:",
    error
  );

  login();
});