const socket = io();

let currentScreen = "login";

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
  currentScreen = id;
}

function login() {
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;
  socket.emit("login", { username, password }, (res) => {
    if (res.success) {
      showScreen("lobby-screen");
    } else {
      alert(res.error);
    }
  });
}

function signup() {
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;
  socket.emit("signup", { username, password }, (res) => {
    if (res.success) {
      showScreen("lobby-screen");
    } else {
      alert(res.error);
    }
  });
}

function enterLobby() {
  socket.emit("enterLobby");
}

socket.on("lobbyUpdate", (list) => {
  const lobbyList = document.getElementById("lobby-list");
  lobbyList.innerHTML = "";
  list.forEach(u => {
    const li = document.createElement("li");
    li.textContent = u;
    lobbyList.appendChild(li);
  });
});

socket.on("invited", ({ from }) => {
  if (confirm(`${from} te convidou para jogar. Aceitar?`)) {
    socket.emit("acceptInvite", from);
  }
});

socket.on("startMatch", ({ opponent }) => {
  alert(`Partida contra ${opponent}!`);
  showScreen("game-screen");
});

function leaveGame() {
  showScreen("lobby-screen");
}
