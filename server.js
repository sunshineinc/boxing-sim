const express = require("express");
const app = express();
const http = require("http").createServer(app);
const { Server } = require("socket.io");
const io = new Server(http);

const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

let users = {}; // { username: { password, premium, score } }
let onlineUsers = {}; // { socket.id: username }
let lobbyUsers = {};  // { socket.id: username }
let invites = {}; // { targetId: fromUsername }
let scores = {};

io.on("connection", (socket) => {
  console.log("Novo usuário conectado:", socket.id);

  // Login
  socket.on("login", ({ username, password }, cb) => {
    if (users[username] && users[username].password === password) {
      onlineUsers[socket.id] = username;
      cb({ success: true, premium: users[username].premium || false });
    } else {
      cb({ success: false, error: "Usuário ou senha incorretos" });
    }
  });

  // Signup
  socket.on("signup", ({ username, password }, cb) => {
    if (users[username]) {
      cb({ success: false, error: "Usuário já existe" });
    } else {
      users[username] = { password, premium: false, score: 0 };
      onlineUsers[socket.id] = username;
      cb({ success: true, premium: false });
    }
  });

  // Entrar no lobby
  socket.on("enterLobby", () => {
    const username = onlineUsers[socket.id];
    if (username) {
      lobbyUsers[socket.id] = username;
      io.emit("lobbyUpdate", Object.values(lobbyUsers));
    }
  });

  // Enviar convite
  socket.on("invite", (targetId) => {
    const fromUser = onlineUsers[socket.id];
    if (fromUser && lobbyUsers[targetId]) {
      invites[targetId] = fromUser;
      io.to(targetId).emit("invited", { from: fromUser });
    }
  });

  // Aceitar convite
  socket.on("acceptInvite", (fromUser) => {
    const username = onlineUsers[socket.id];
    if (username) {
      io.to(socket.id).emit("startMatch", { opponent: fromUser });
      for (const [id, name] of Object.entries(onlineUsers)) {
        if (name === fromUser) {
          io.to(id).emit("startMatch", { opponent: username });
        }
      }
    }
  });

  // Auto-match a cada 2 minutos
  setInterval(() => {
    const ids = Object.keys(lobbyUsers);
    if (ids.length >= 2) {
      const [p1, p2] = ids.slice(0, 2);
      io.to(p1).emit("startMatch", { opponent: lobbyUsers[p2] });
      io.to(p2).emit("startMatch", { opponent: lobbyUsers[p1] });
      delete lobbyUsers[p1];
      delete lobbyUsers[p2];
      io.emit("lobbyUpdate", Object.values(lobbyUsers));
    }
  }, 120000);

  // Sair
  socket.on("disconnect", () => {
    delete lobbyUsers[socket.id];
    delete onlineUsers[socket.id];
    io.emit("lobbyUpdate", Object.values(lobbyUsers));
    console.log("Usuário saiu:", socket.id);
  });
});

http.listen(PORT, () => {
  console.log("Servidor rodando em http://localhost:" + PORT);
});
