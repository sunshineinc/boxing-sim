import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

let socket = null; // socket só inicializa após login/signup

// UI elements
const centerCard = document.getElementById('center');
const loginPanel = document.getElementById('login-panel');
const signupPanel = document.getElementById('signup-panel');
const tabLogin = document.getElementById('tab-login');
const tabSignup = document.getElementById('tab-signup');
const btnLogin = document.getElementById('btn-login');
const btnSignup = document.getElementById('btn-signup');
const signupNick = document.getElementById('signup-nick');
const signupEmail = document.getElementById('signup-email');
const signupPass = document.getElementById('signup-pass');
const loginEmail = document.getElementById('login-email');
const loginPass = document.getElementById('login-pass');
const lobbyUi = document.getElementById('lobby-ui');
const playersList = document.getElementById('players-list');
const adsArea = document.getElementById('ads-area');
const meNickSpan = document.getElementById('me-nick');
const inviteModal = document.getElementById('invite-modal');
const inviteText = document.getElementById('invite-text');
const inviteAccept = document.getElementById('invite-accept');
const inviteReject = document.getElementById('invite-reject');
const canvas = document.getElementById('game');

let token = localStorage.getItem('token');
let myNick = null;
let inLobby = false;

// Tabs
tabLogin.onclick = ()=>{ tabLogin.classList.add('active'); tabSignup.classList.remove('active'); loginPanel.classList.remove('hidden'); signupPanel.classList.add('hidden'); }
tabSignup.onclick = ()=>{ tabSignup.classList.add('active'); tabLogin.classList.remove('active'); signupPanel.classList.remove('hidden'); loginPanel.classList.add('hidden'); }

btnSignup.onclick = async ()=>{
  try{
    const res = await fetch('/api/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ email: signupEmail.value, password: signupPass.value, nick: signupNick.value })});
    const j = await res.json();
    if(!res.ok) throw new Error(j.error||'erro');
    token = j.token; localStorage.setItem('token', token);
    myNick = j.user.nick; startLobby();
  }catch(e){ alert('Erro ao criar: '+e.message) }
};

btnLogin.onclick = async ()=>{
  try{
    const res = await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ email: loginEmail.value, password: loginPass.value })});
    const j = await res.json();
    if(!res.ok) throw new Error(j.error||'erro');
    token = j.token; localStorage.setItem('token', token);
    myNick = j.user.nick; startLobby();
  }catch(e){ alert('Erro ao logar: '+e.message) }
};

document.getElementById('btn-logout').onclick = ()=>{ localStorage.removeItem('token'); location.reload(); };
document.getElementById('btn-refresh').onclick = ()=> socket && socket.emit('lobby:refresh');
document.getElementById('btn-toggle-join').onclick = ()=>{
  if(inLobby){ socket.emit('lobby:leave'); inLobby=false; document.getElementById('btn-toggle-join').textContent='Entrar no Lobby'; }
  else{ socket.emit('lobby:join', { token, nick: myNick }); inLobby=true; document.getElementById('btn-toggle-join').textContent='Sair do Lobby'; }
};

let pendingInviteFrom = null;
inviteAccept.onclick = ()=>{ if(pendingInviteFrom){ socket.emit('invite:respond',{ fromSocketId: pendingInviteFrom, accept:true }); inviteModal.classList.add('hidden'); pendingInviteFrom=null; startFightUI(); } };
inviteReject.onclick = ()=>{ if(pendingInviteFrom){ socket.emit('invite:respond',{ fromSocketId: pendingInviteFrom, accept:false }); inviteModal.classList.add('hidden'); pendingInviteFrom=null; } };

// start lobby UI
async function startLobby(){
    // criar conexão socket aqui, só depois do login/signup
    socket = io();

    // agora registre todos os handlers do socket
    socket.on('lobby:update', (list)=>{
        playersList.innerHTML = '';
        list.forEach(p=>{
            const d = document.createElement('div');
            d.innerHTML = `<span class="player-label">${p.nick}</span> <button data-id="${p.socketId}">Convidar</button>`;
            const btn = d.querySelector('button'); btn.onclick = ()=>{ socket.emit('invite:send',{ targetSocketId: p.socketId }); alert('Convite enviado para '+p.nick); };
            playersList.appendChild(d);
        });
    });

    socket.on('ads:update', (ads)=>{
        adsArea.innerHTML = '';
        ads.forEach(ad=>{
            const el = document.createElement('div');
            el.innerHTML = `<strong>${ad.title}</strong> - <a href="${ad.url}" target="_blank">Visitar</a>`;
            adsArea.appendChild(el);
        });
    });

    socket.on('invite:received', ({ fromSocketId, fromNick })=>{
        pendingInviteFrom = fromSocketId;
        inviteText.textContent = fromNick + ' te convidou para uma luta! Aceitar?';
        inviteModal.classList.remove('hidden');
    });

    socket.on('invite:rejected', ({ by })=> alert('Convite rejeitado por '+by));

    socket.on('match:found', ({ opponent, opponentSocket })=>{
      if(confirm('Match encontrado com '+opponent+' — aceitar?')){
        socket.emit('invite:respond', { fromSocketId: opponentSocket, accept:true });
        startFightUI();
      }else{
        socket.emit('invite:respond', { fromSocketId: opponentSocket, accept:false });
      }
    });

    socket.on('fight:start', ({ room, players })=>{
      startFightUI(players);
    });

    // entrar no lobby
    socket.emit('lobby:join', { token, nick: myNick });

    // UI
    document.getElementById('auth-forms').classList.add('hidden');
    lobbyUi.classList.remove('hidden');
    centerCard.style.minWidth='520px';
    meNickSpan.textContent = myNick || 'Guest';

    startGame();
}

// resto do código Three.js permanece igual (copiar de app.js anterior)
// ... você manteria as funções animate(), startGame(), etc.
