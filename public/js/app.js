import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const socket = io();

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
document.getElementById('btn-refresh').onclick = ()=> socket.emit('lobby:refresh');
document.getElementById('btn-toggle-join').onclick = ()=>{
  if(inLobby){ socket.emit('lobby:leave'); inLobby=false; document.getElementById('btn-toggle-join').textContent='Entrar no Lobby'; }
  else{ socket.emit('lobby:join', { token, nick: myNick }); inLobby=true; document.getElementById('btn-toggle-join').textContent='Sair do Lobby'; }
};

let pendingInviteFrom = null;
inviteAccept.onclick = ()=>{ if(pendingInviteFrom){ socket.emit('invite:respond',{ fromSocketId: pendingInviteFrom, accept:true }); inviteModal.classList.add('hidden'); pendingInviteFrom=null; startFightUI(); } };
inviteReject.onclick = ()=>{ if(pendingInviteFrom){ socket.emit('invite:respond',{ fromSocketId: pendingInviteFrom, accept:false }); inviteModal.classList.add('hidden'); pendingInviteFrom=null; } };

// start lobby UI
async function startLobby(){ document.getElementById('auth-forms').classList.add('hidden'); lobbyUi.classList.remove('hidden'); centerCard.style.minWidth='520px'; meNickSpan.textContent = myNick || 'Guest'; socket.emit('lobby:join', { token, nick: myNick }); startGame(); }

// Socket handlers
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
  // room started, client will show fight UI (we already show canvas)
  console.log('fight starting', room, players);
  startFightUI(players);
});

socket.on('scores:update', (scores)=>{
  // optional: show top scores in UI
  console.log('scores updated', scores);
});

// ------------------ Three.js game + camera follow + labels ------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x081020);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 100); camera.position.set(0,6,10);
const light = new THREE.DirectionalLight(0xffffff,1); light.position.set(5,10,7); scene.add(light); scene.add(new THREE.AmbientLight(0xffffff,0.4));
const ring = new THREE.Mesh(new THREE.BoxGeometry(18,0.5,18), new THREE.MeshPhongMaterial({ color:0x203040 })); ring.position.y=-0.25; scene.add(ring);

const playersMap = new Map(); // socketId -> { mesh, labelEl, state }

function makeBoxer(color=0xff5555){
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35,1.0,6,12), new THREE.MeshPhongMaterial({ color }));
  body.position.y = 1.0; g.add(body);
  const gloveL = new THREE.Mesh(new THREE.SphereGeometry(0.2,16,16), new THREE.MeshPhongMaterial({ color:0xaa0000 }));
  const gloveR = gloveL.clone(); gloveL.position.set(-0.45,1.0,0.1); gloveR.position.set(0.45,1.0,0.1);
  g.add(gloveL, gloveR);
  return g;
}

function ensurePlayer(id, state){
  if(!playersMap.has(id)){
    const isMe = id===socket.id;
    const color = isMe?0x55ffaa:0xff5555;
    const mesh = makeBoxer(color); scene.add(mesh);
    const label = document.createElement('div'); label.className='player-label'; label.style.position='absolute'; label.style.pointerEvents='none'; label.textContent = state.nick || 'Player';
    document.body.appendChild(label);
    playersMap.set(id, { mesh, label, state });
  }
  return playersMap.get(id);
}

socket.on('state:init', (all)=>{ for(const [id,s] of Object.entries(all)) ensurePlayer(id,s); });
socket.on('player:join', ({id,state})=> ensurePlayer(id,state));
socket.on('player:leave', (id)=>{ const p = playersMap.get(id); if(p){ scene.remove(p.mesh); p.label.remove(); playersMap.delete(id);} });
socket.on('state:update', (all)=>{ for(const [id,s] of Object.entries(all)){ const p = ensurePlayer(id,s); p.state = s; p.mesh.position.set(s.x,s.y,s.z); p.mesh.rotation.y = s.rotY; } });

// movement smoothing: client sends inputs, server authoritative updates
const keys = new Set();
window.addEventListener('keydown', e=> keys.add(e.key.toLowerCase()));
window.addEventListener('keyup', e=> keys.delete(e.key.toLowerCase()));

function projectToScreen(pos, camera){
  const width = window.innerWidth, height = window.innerHeight;
  const proj = pos.clone().project(camera);
  return { x: (proj.x+1)/2 * width, y: (-proj.y+1)/2 * height };
}

let last = performance.now();
function animate(now){
  const dt = Math.min(0.05,(now-last)/1000); last = now;
  // send input
  const forward = (keys.has('w')||keys.has('arrowup')?1:0) + (keys.has('s')||keys.has('arrowdown')?-1:0);
  const right = (keys.has('d')||keys.has('arrowright')?1:0) + (keys.has('a')||keys.has('arrowleft')?-1:0);
  const punch = keys.has(' ');
  let rotY = 0; if(forward!==0||right!==0) rotY = Math.atan2(forward, right);
  socket.emit('input',{ forward, right, punch, rotY, dt });
  // update labels positions
  for(const [id,p] of playersMap.entries()){
    const pos = new THREE.Vector3().setFromMatrixPosition(p.mesh.matrixWorld);
    pos.y += 2.1;
    const scr = projectToScreen(pos, camera);
    p.label.style.left = (scr.x - p.label.offsetWidth/2)+'px';
    p.label.style.top = (scr.y - 20)+'px';
    p.label.textContent = p.state?.nick || 'Player';
  }
  // camera follow local player
  const me = playersMap.get(socket.id);
  if(me){
    const target = new THREE.Vector3().copy(me.mesh.position); target.y += 1.6;
    // smooth follow
    camera.position.lerp(new THREE.Vector3(target.x, target.y+5, target.z+8), 0.08);
    camera.lookAt(target.x, target.y, target.z);
  }
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// fight UI show canvas and center card hide
function startFightUI(playersList){ document.getElementById('center').classList.add('hidden'); canvas.classList.remove('hidden'); }

window.addEventListener('resize', ()=>{ renderer.setSize(window.innerWidth, window.innerHeight, false); });
