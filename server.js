
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const app = express();
app.use(express.json({limit:"1mb"}));
app.use(express.urlencoded({extended:false}));

const pool = new Pool({connectionString: process.env.DATABASE_URL});
const SESSION_DAYS = 30;

function cookieOpts(){ return `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS*86400}`; }
function hashToken(token){ return crypto.createHash("sha256").update(token).digest("hex"); }

async function init(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assignments (
      task_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      assigned_to TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(task_id, period)
    );
    CREATE TABLE IF NOT EXISTS completions (
      task_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      completed_by TEXT NOT NULL,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(task_id, period)
    );
  `);
  const count=(await pool.query("SELECT count(*)::int AS n FROM users")).rows[0].n;
  if(count===0){
    const lp=process.env.LOUISA_PASSWORD;
    const pp=process.env.PATRICK_PASSWORD;
    if(!lp || !pp) throw new Error("Set LOUISA_PASSWORD and PATRICK_PASSWORD before first start.");
    await pool.query("INSERT INTO users(username,password_hash,display_name) VALUES ($1,$2,$3),($4,$5,$6)",
      ["louisa",await bcrypt.hash(lp,12),"Louisa","patrick",await bcrypt.hash(pp,12),"Patrick"]);
  }
}

async function auth(req,res,next){
  const m=(req.headers.cookie||"").match(/(?:^|;\s*)ht_session=([^;]+)/);
  if(!m) return res.status(401).json({error:"Nicht angemeldet"});
  const h=hashToken(decodeURIComponent(m[1]));
  const r=await pool.query("SELECT u.id,u.username,u.display_name,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",[h]);
  if(!r.rowCount) return res.status(401).json({error:"Sitzung abgelaufen"});
  req.user=r.rows[0]; next();
}

app.post("/api/login", async (req,res)=>{
  const {username,password}=req.body||{};
  const r=await pool.query("SELECT * FROM users WHERE username=$1",[String(username||"").toLowerCase()]);
  if(!r.rowCount || !(await bcrypt.compare(String(password||""),r.rows[0].password_hash))) return res.status(401).json({error:"Benutzername oder Passwort falsch"});
  const token=crypto.randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')",[hashToken(token),r.rows[0].id]);
  res.setHeader("Set-Cookie",`ht_session=${encodeURIComponent(token)}; ${cookieOpts()}`);
  res.json({user:{username:r.rows[0].username,displayName:r.rows[0].display_name}});
});
app.post("/api/logout",auth,async(req,res)=>{
  const m=(req.headers.cookie||"").match(/(?:^|;\s*)ht_session=([^;]+)/);
  if(m) await pool.query("DELETE FROM sessions WHERE token_hash=$1",[hashToken(decodeURIComponent(m[1]))]);
  res.setHeader("Set-Cookie","ht_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0");
  res.json({ok:true});
});
app.get("/api/me",auth,(req,res)=>res.json({user:{username:req.user.username,displayName:req.user.display_name}}));

app.get("/api/state",auth,async(req,res)=>{
  const [a,c]=await Promise.all([
    pool.query("SELECT task_id,period,assigned_to FROM assignments"),
    pool.query("SELECT task_id,period,completed_by,completed_at FROM completions")
  ]);
  res.json({assignments:a.rows,completions:c.rows});
});
app.post("/api/assign",auth,async(req,res)=>{
  const {taskId,period,assignedTo}=req.body||{};
  if(!Number.isInteger(taskId)||!period||!["Louisa","Patrick","shared"].includes(assignedTo)) return res.status(400).json({error:"Ungültige Zuteilung"});
  await pool.query("INSERT INTO assignments(task_id,period,assigned_to) VALUES($1,$2,$3) ON CONFLICT(task_id,period) DO UPDATE SET assigned_to=excluded.assigned_to",[taskId,period,assignedTo]);
  res.json({ok:true});
});
app.post("/api/complete",auth,async(req,res)=>{
  const {taskId,period}=req.body||{};
  if(!Number.isInteger(taskId)||!period) return res.status(400).json({error:"Ungültige Aufgabe"});
  const ar=await pool.query("SELECT assigned_to FROM assignments WHERE task_id=$1 AND period=$2",[taskId,period]);
  if(!ar.rowCount) return res.status(400).json({error:"Aufgabe wurde noch nicht zugeteilt"});
  await pool.query("INSERT INTO completions(task_id,period,completed_by) VALUES($1,$2,$3) ON CONFLICT(task_id,period) DO NOTHING",[taskId,period,req.user.display_name]);
  res.json({ok:true});
});

app.use(express.static(path.join(__dirname,"public")));
app.get("/{*splat}",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

const port=process.env.PORT||8080;
init().then(()=>app.listen(port,"0.0.0.0",()=>console.log("HaushaltsTasse listening on",port)))
  .catch(e=>{console.error(e);process.exit(1)});
