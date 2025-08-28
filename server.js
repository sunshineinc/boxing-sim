import express from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import url from "url";

dotenv.config();
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-this";
const CRYPT_KEY_BASE64 = process.env.CRYPT_KEY_BASE64 || null;

function getKey() {
  if (!CRYPT_KEY_BASE64) return null;
  const key = Buffer.from(CRYPT_KEY_BASE64, "base64");
  if (key.length !== 32) throw new Error("CRYPT_KEY_BASE64 must be 32 bytes.");
  return key;
}
function encryptJSON(obj) {
  const key = getKey();
  const data = Buffer.from(JSON.stringify(obj), "utf8");
  if (!key) return data;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from("GCM1"), iv, tag, enc]);
}
function decryptJSON(buf) {
  const key = getKey();
  if (!buf || buf.length === 0) return { users: [], payments: [] };
  if (!key) {
    try { return JSON.parse(buf.toString("utf8")); } catch { return { users: [], payments: [] }; }
  }
  const magic = buf.subarray(0,4).toString("utf8");
  if (magic !== "GCM1") return { users: [], payments: [] };
  const iv = buf.subarray(4, 16);
  const tag = buf.subarray(16, 32);
  const enc = buf.subarray(32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(dec.toString("utf8"));
}

const dataFile = path.join(__dirname, "data.enc");
function loadDB() {
  if (!fs.existsSync(dataFile)) return { users: [], payments: [] };
  const buf = fs.readFileSync(dataFile);
  return decryptJSON(buf);
}
function saveDB(db) {
  const buf = encryptJSON(db);
  fs.writeFileSync(dataFile, buf);
}
const db = loadDB();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function createToken(user) {
  return jwt.sign({ id: user.id, email: user.email, plan: user.plan, nickname: user.nickname, cosmetics: user.cosmetics }, JWT_SECRET, { expiresIn: "7d" });
}

app.post("/api/signup", (req,res)=>{
  const { email, password, nickname } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email e senha obrigatórios" });
  if (db.users.find(u=>u.email===email)) return res.status(409).json({ error: "Email já cadastrado" });
  const hash = bcrypt.hashSync(password, 10);
  const user = { id: uuidv4(), email, passhash: hash, nickname: nickname||"Boxer", plan: "free", createdAt: Date.now(), cosmetics: { gloves: "default", skin: "default" } };
  db.users.push(user); saveDB(db);
  const token = createToken(user);
  res.json({ token, user: { id: user.id, email: user.email, nickname: user.nickname, plan: user.plan, cosmetics: user.cosmetics } });
});

app.post("/api/login", (req,res)=>{
  const { email, password } = req.body || {};
  const user = db.users.find(u=>u.email===email);
  if (!user) return res.status(401).json({ error: "Credenciais inválidas" });
  const ok = bcrypt.compareSync(password, user.passhash);
  if (!ok) return res.status(401).json({ error: "Credenciais inválidas" });
  const token = createToken(user);
  res.json({ token, user: { id: user.id, email: user.email, nickname: user.nickname, plan: user.plan, cosmetics: user.cosmetics } });
});

app.post("/api/payments/mock-confirm", (req,res)=>{
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.substring(7) : null;
  if (!token) return res.status(401).json({ error: "Token ausente" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.users.find(u=>u.id===payload.id);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado" });
    const { currency } = req.body || {};
    if (!currency || !["BRL","USD"].includes(currency)) return res.status(400).json({ error: "Moeda inválida" });
    const price = currency === "BRL" ? 25.00 : 4.62;
    user.plan = "paid";
    db.payments.push({ id: uuidv4(), userId: user.id, currency, amount: price, confirmedAt: Date.now(), method: "mock" });
    saveDB(db);
    const newToken = createToken(user);
    res.json({ ok: true, plan: user.plan, token: newToken, price });
  } catch (e) {
    return res.status(401).json({ error: "Token inválido" });
  }
});

app.post("/api/cosmetics", (req,res)=>{
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.substring(7) : null;
  if (!token) return res.status(401).json({ error: "Token ausente" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.users.find(u=>u.id===payload.id);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado" });
    if (user.plan !== "paid") return res.status(403).json({ error: "Requer plano pago" });
    const { gloves, skin } = req.body || {};
    if (gloves) user.cosmetics.gloves = gloves;
    if (skin) user.cosmetics.skin = skin;
    saveDB(db);
    res.json({ ok:true, cosmetics: user.cosmetics });
  } catch (e) {
    return res.status(401).json({ error: "Token inválido" });
  }
});

const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: "*", methods: ["GET","POST"] } });

const players = new Map();
io.on("connection", (socket)=>{
  socket.on("auth", (token)=>{
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      socket.data.user = payload;
      socket.join("ring");
      const spawn = { x: Math.random()*6-3, z: Math.random()*6-3, y: 1.0, rotY: 0, hp: 100, speedMul: payload.plan==="paid"?1.6:1.0, nickname: payload.nickname, cosmetics: payload.cosmetics };
      players.set(socket.id, spawn);
      socket.emit("state:init", Object.fromEntries(players));
      io.to("ring").emit("player:join", { id: socket.id, state: spawn });
    } catch {
      socket.emit("error","auth_failed");
    }
  });

  socket.on("input", (data)=>{
    const s = players.get(socket.id);
    if (!s) return;
    const { forward=0, right=0, punch=false, superSpeed=false, rotY=0, dt=0.016 } = data || {};
    const base = 2.5;
    const speedMul = (superSpeed && socket.data?.user?.plan==="paid") ? 2.2 : 1.0;
    s.rotY = rotY;
    s.x += (Math.sin(rotY) * forward + Math.cos(rotY) * right) * base * s.speedMul * speedMul * dt;
    s.z += (Math.cos(rotY) * forward - Math.sin(rotY) * right) * base * s.speedMul * speedMul * dt;
    s.x = Math.max(-4, Math.min(4, s.x));
    s.z = Math.max(-4, Math.min(4, s.z));
    if (punch) {
      for (const [pid, ps] of players.entries()) {
        if (pid===socket.id) continue;
        const dx = ps.x - s.x; const dz = ps.z - s.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 1.2) {
          const angTo = Math.atan2(dx, dz);
          let d = Math.abs(((s.rotY - angTo + Math.PI) % (2*Math.PI)) - Math.PI);
          if (d < 0.7) {
            ps.hp = Math.max(0, ps.hp - 6);
            if (ps.hp === 0) { ps.x = Math.random()*6-3; ps.z = Math.random()*6-3; ps.hp = 100; }
          }
        }
      }
    }
    players.set(socket.id, s);
  });

  socket.on("disconnect", ()=>{
    players.delete(socket.id);
    io.to("ring").emit("player:leave", socket.id);
  });
});

setInterval(()=>{ if (io.engine.clientsCount > 0) io.to("ring").emit("state:update", Object.fromEntries(players)); }, 50);

server.listen(PORT, ()=>{ console.log(`Servidor rodando em http://localhost:${PORT}`); if (!process.env.CRYPT_KEY_BASE64) console.log("Sem CRYPT_KEY_BASE64: data.enc ficará em texto (DEV)."); });
