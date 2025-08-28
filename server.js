import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import url from "url";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";

dotenv.config();
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// In-memory DB (for prototyping)
const db = { users: [], ads: [], scores: {} }; // users: {id,email,passhash,nick,plan,cosmetics}

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

function createToken(user){ return jwt.sign({ id: user.id, email: user.email, nick: user.nick, plan: user.plan }, JWT_SECRET, { expiresIn: "7d" }); }
function authFromHeader(req){ const a = req.headers.authorization||''; return a.startsWith('Bearer ') ? a.substring(7) : null; }
function getUserFromToken(token){ try{ return jwt.verify(token, JWT_SECRET); }catch{return null;} }

// Auth endpoints
app.post('/api/signup', (req,res)=>{
  const { email, password, nick } = req.body||{};
  if(!email||!password) return res.status(400).json({ error: "email and password required" });
  if(db.users.find(u=>u.email===email)) return res.status(409).json({ error: "email exists" });
  const hash = bcrypt.hashSync(password, 10);
  const user = { id: uuidv4(), email, passhash: hash, nick: nick||("Player"+Math.floor(Math.random()*1000)), plan: "free", cosmetics:{gloves:"default",skin:"default"}, createdAt: Date.now() };
  db.users.push(user);
  db.scores[user.id] = 0;
  const token = createToken(user);
  res.json({ token, user: { id: user.id, email: user.email, nick: user.nick, plan: user.plan } });
});

app.post('/api/login', (req,res)=>{
  const { email, password } = req.body||{};
  const user = db.users.find(u=>u.email===email);
  if(!user) return res.status(401).json({ error: "invalid credentials" });
  if(!bcrypt.compareSync(password, user.passhash)) return res.status(401).json({ error: "invalid credentials" });
  const token = createToken(user);
  res.json({ token, user: { id: user.id, email: user.email, nick: user.nick, plan: user.plan } });
});

// Mock payments: upgrade to 'paid' or 'premium'
app.post('/api/pay/mock', (req,res)=>{
  const token = authFromHeader(req);
  const payload = getUserFromToken(token);
  if(!payload) return res.status(401).json({ error: "unauth" });
  const user = db.users.find(u=>u.id===payload.id);
  if(!user) return res.status(404).json({ error: "user not found" });
  const { tier } = req.body || {}; // 'paid' or 'premium'
  if(!['paid','premium'].includes(tier)) return res.status(400).json({ error: "invalid tier" });
  user.plan = tier;
  const newToken = createToken(user);
  res.json({ ok:true, plan:user.plan, token:newToken });
});

// Ads: only premium can post ads
app.post('/api/ads', (req,res)=>{
  const token = authFromHeader(req); const payload = getUserFromToken(token);
  if(!payload) return res.status(401).json({ error: "unauth" });
  const user = db.users.find(u=>u.id===payload.id);
  if(!user) return res.status(404).json({ error: "user not found" });
  if(user.plan!=='premium') return res.status(403).json({ error: "premium required" });
  const { title, url, image } = req.body || {};
  const ad = { id: uuidv4(), ownerId: user.id, title: title||"Anúncio", url: url||"#", image: image||null, createdAt: Date.now() };
  db.ads.push(ad);
  // broadcast via socket later (server has io reference)
  if(global.io) global.io.emit('ads:update', db.ads);
  res.json({ ok:true, ad });
});

app.get('/api/ads', (req,res)=> res.json({ ads: db.ads }));
app.get('/api/score/:id', (req,res)=> { const id = req.params.id; res.json({ score: db.scores[id]||0 }); });
app.get('/api/me', (req,res)=>{ const token = authFromHeader(req); const p = getUserFromToken(token); if(!p) return res.status(401).json({ error: "unauth" }); const user = db.users.find(u=>u.id===p.id); if(!user) return res.status(404).json({ error: "user not found" }); res.json({ user:{ id:user.id, nick:user.nick, plan:user.plan, cosmetics:user.cosmetics } }); });

// Serve index
app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

// --- Socket.io lobby + matches ---
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
global.io = io;

const players = new Map(); // socket.id -> {userId, nick, state...}
const pendingInvites = new Map(); // targetSocketId -> {fromId, fromSocketId, expires}

// Auto-match every 2 minutes: pick two waiting players and start battle
setInterval(()=>{
  try{
    const waiting = Array.from(players.entries()).filter(([sid,p])=>p.inLobby);
    if(waiting.length >= 2){
      // pick random pair
      const a = waiting[Math.floor(Math.random()*waiting.length)][0];
      let b = a;
      while(b===a) b = waiting[Math.floor(Math.random()*waiting.length)][0];
      io.to(a).emit('match:found', { opponent: players.get(b).nick, opponentSocket: b });
      io.to(b).emit('match:found', { opponent: players.get(a).nick, opponentSocket: a });
      // after both accept they'll start via client emit 'match:start'
    }
  }catch(e){ console.error(e); }
}, 120000); // 2 minutes

io.on('connection', (socket)=>{
  console.log('socket connected', socket.id);
  socket.on('lobby:join', (payload)=>{
    // payload may contain token
    let user = null;
    if(payload?.token){
      const p = getUserFromToken(payload.token);
      if(p) user = db.users.find(u=>u.id===p.id);
    }
    const nick = (user && user.nick) || payload?.nick || ("Guest"+socket.id.slice(0,4));
    players.set(socket.id, { socketId: socket.id, userId: user?.id||null, nick, inLobby:true, inFight:false });
    socket.join('lobby');
    io.to('lobby').emit('lobby:update', Array.from(players.values()).map(p=>({ socketId:p.socketId, nick:p.nick, inLobby:p.inLobby })));
    // send ads and scores
    socket.emit('ads:update', db.ads);
  });

  socket.on('lobby:leave', ()=>{
    const p = players.get(socket.id); if(p) p.inLobby = false;
    socket.leave('lobby');
    io.to('lobby').emit('lobby:update', Array.from(players.values()).map(p=>({ socketId:p.socketId, nick:p.nick, inLobby:p.inLobby })));
  });

  socket.on('invite:send', ({ targetSocketId })=>{
    const from = players.get(socket.id); const target = players.get(targetSocketId);
    if(!from||!target) return;
    // store invite, expires in 30s
    pendingInvites.set(targetSocketId, { fromSocketId: socket.id, expires: Date.now()+30000 });
    io.to(targetSocketId).emit('invite:received', { fromSocketId: socket.id, fromNick: from.nick });
  });

  socket.on('invite:respond', ({ fromSocketId, accept })=>{
    const invite = pendingInvites.get(socket.id);
    if(!invite || invite.fromSocketId !== fromSocketId) return;
    const from = players.get(fromSocketId);
    const to = players.get(socket.id);
    pendingInvites.delete(socket.id);
    if(accept){
      // start fight between fromSocketId and socket.id
      const room = 'fight-' + uuidv4();
      [fromSocketId, socket.id].forEach(sid=>{
        io.sockets.sockets.get(sid)?.join(room);
        const p = players.get(sid); if(p){ p.inFight = true; p.inLobby = false; }
      });
      io.to(room).emit('fight:start', { room, players: [{ id: fromSocketId, nick: from.nick }, { id: socket.id, nick: to.nick }] });
      io.to('lobby').emit('lobby:update', Array.from(players.values()).map(p=>({ socketId:p.socketId, nick:p.nick, inLobby:p.inLobby })));
    }else{
      io.to(fromSocketId).emit('invite:rejected', { by: players.get(socket.id).nick });
    }
  });

  socket.on('fight:result', ({ winnerSocketId, points=1 })=>{
    // award points to winner if exists and userId known
    const winner = players.get(winnerSocketId);
    if(winner && winner.userId){
      db.scores[winner.userId] = (db.scores[winner.userId]||0) + points;
    }
    // broadcast new scores
    io.emit('scores:update', db.scores);
    // mark both players as back to lobby
    const roomSockets = Array.from(socket.rooms).filter(r=>r.startsWith('fight-'));
    // naive: set all players not in fight to inLobby true
    for(const [sid,p] of players.entries()){ if(p) { p.inFight = false; p.inLobby = true; } }
    io.to('lobby').emit('lobby:update', Array.from(players.values()).map(p=>({ socketId:p.socketId, nick:p.nick, inLobby:p.inLobby })));
  });

  socket.on('disconnect', ()=>{
    players.delete(socket.id);
    pendingInvites.delete(socket.id);
    io.to('lobby').emit('lobby:update', Array.from(players.values()).map(p=>({ socketId:p.socketId, nick:p.nick, inLobby:p.inLobby })));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log('Server listening on', PORT));
