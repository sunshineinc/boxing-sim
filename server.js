import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import url from "url";

dotenv.config();
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET","POST"] } });

const players = new Map();

io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  socket.on("auth", (payload) => {
    socket.data.nickname = payload?.nickname || ("Player-" + socket.id.slice(0,4));
    players.set(socket.id, { x:0, y:0, z:0, rotY:0, hp:100, nickname: socket.data.nickname });
    socket.join("ring");
    socket.emit("state:init", Object.fromEntries(players));
    io.to("ring").emit("player:join", { id: socket.id, state: players.get(socket.id) });
  });

  socket.on("input", (data) => {
    const s = players.get(socket.id);
    if (!s) return;
    const { forward=0, right=0, rotY=0, dt=0.016, punch=false } = data || {};
    const speed = 2.5;
    s.rotY = rotY;
    s.x += (Math.sin(rotY)*forward + Math.cos(rotY)*right) * speed * dt;
    s.z += (Math.cos(rotY)*forward - Math.sin(rotY)*right) * speed * dt;
    s.x = Math.max(-8, Math.min(8, s.x));
    s.z = Math.max(-8, Math.min(8, s.z));
    if (punch) {
      for (const [pid, ps] of players.entries()) {
        if (pid === socket.id) continue;
        const dx = ps.x - s.x;
        const dz = ps.z - s.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 1.2) {
          ps.hp = Math.max(0, ps.hp - 6);
          if (ps.hp === 0) { ps.hp = 100; ps.x = (Math.random()*12-6); ps.z = (Math.random()*12-6); }
        }
      }
    }
    players.set(socket.id, s);
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
    io.to("ring").emit("player:leave", socket.id);
  });
});

setInterval(()=>{ if (io.engine.clientsCount > 0) io.to("ring").emit("state:update", Object.fromEntries(players)); }, 50);

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log("Server running on port", PORT));
