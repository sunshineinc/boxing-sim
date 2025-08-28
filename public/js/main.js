import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { io } from '/socket.io/socket.io.js';

const API = location.origin;
let token = localStorage.getItem("token");
let currentUser = null;

const el = (id)=>document.getElementById(id);

document.querySelectorAll(".tab").forEach(btn=>{
  btn.onclick = ()=>{
    document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    el("panel-login").classList.toggle("hidden", tab!=="login");
    el("panel-signup").classList.toggle("hidden", tab!=="signup");
  };
});

async function api(path, data, method="POST"){
  const res = await fetch(API+path,{method,headers:{"Content-Type":"application/json", ...(token?{"Authorization":"Bearer "+token}:{})},body:data?JSON.stringify(data):undefined});
  if (!res.ok) throw new Error((await res.json()).error||"Erro");
  return res.json();
}

function setLoggedIn(u,newToken){
  if(newToken){ token=newToken; localStorage.setItem("token",token); }
  currentUser=u;
  el("auth").classList.add("hidden");
  el("user-area").classList.remove("hidden");
  el("user-label").textContent = `${u.nickname||u.email}`;
  el("plan-label").textContent = u.plan==="paid" ? "Plano: Pago" : "Plano: Gratuito";
  el("cosmetics").classList.toggle("hidden", u.plan!=="paid");
  if (!window.gameStarted) startGame();
}

el("btn-signup").onclick = async ()=>{
  try{ const email = el("signup-email").value.trim(); const password = el("signup-pass").value; const nickname = el("signup-nick").value.trim(); const data = await api("/api/signup",{email,password,nickname}); setLoggedIn(data.user,data.token);}catch(e){alert(e.message)}
};
el("btn-login").onclick = async ()=>{ try{ const email = el("login-email").value.trim(); const password = el("login-pass").value; const data = await api("/api/login",{email,password}); setLoggedIn(data.user,data.token);}catch(e){alert(e.message)} };
el("btn-mock-brl").onclick = async ()=>{ try{ const res = await api("/api/payments/mock-confirm", { currency: "BRL" }); alert(`Pagamento mock confirmado: R$ ${res.price.toFixed(2)}`); token = res.token; localStorage.setItem("token", token); currentUser.plan="paid"; el("plan-label").textContent="Plano: Pago"; el("cosmetics").classList.remove("hidden"); }catch(e){alert(e.message)} };
el("btn-mock-usd").onclick = async ()=>{ try{ const res = await api("/api/payments/mock-confirm", { currency: "USD" }); alert(`Pagamento mock confirmado: US$ ${res.price.toFixed(2)}`); token = res.token; localStorage.setItem("token", token); currentUser.plan="paid"; el("plan-label").textContent="Plano: Pago"; el("cosmetics").classList.remove("hidden"); }catch(e){alert(e.message)} };
el("btn-logout").onclick = ()=>{ localStorage.removeItem("token"); location.reload(); };
el("btn-apply-cosmetics").onclick = async ()=>{ try{ const skin = el("skin-select").value; const gloves = el("gloves-select").value; await api("/api/cosmetics",{ skin, gloves }); alert("Cosméticos aplicados!"); }catch(e){alert(e.message)} };

if (token){
  try { const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); setLoggedIn({ id: payload.id, email: payload.email, nickname: payload.nickname, plan: payload.plan, cosmetics: payload.cosmetics || {} }); } catch {}
}

function startGame(){
  window.gameStarted = true;
  const canvas = document.getElementById("game");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b0e13);
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 100);
  camera.position.set(0,7,10);
  const light = new THREE.DirectionalLight(0xffffff,1.0); light.position.set(5,10,7); scene.add(light, new THREE.AmbientLight(0xffffff,0.4));
  const ringGeo = new THREE.BoxGeometry(10,0.5,10); const ringMat = new THREE.MeshPhongMaterial({ color: 0x203040 });
  const ring = new THREE.Mesh(ringGeo, ringMat); ring.position.y = -0.25; scene.add(ring);
  const players = new Map();
  function makeBoxer(color=0xff5555){ const g = new THREE.Group(); const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35,1.0,6,12), new THREE.MeshPhongMaterial({ color })); body.position.y = 1.0; g.add(body); const gloveL = new THREE.Mesh(new THREE.SphereGeometry(0.2,16,16), new THREE.MeshPhongMaterial({ color: 0xaa0000 })); const gloveR = gloveL.clone(); gloveL.position.set(-0.45,1.0,0.1); gloveR.position.set(0.45,1.0,0.1); g.add(gloveL,gloveR); return g; }
  const socket = io();
  socket.on("connect", ()=>{ socket.emit("auth", token); });
  socket.on("state:init", (all)=>{ for (const [id,s] of Object.entries(all)) ensurePlayer(id,s); });
  socket.on("player:join", ({id,state})=>ensurePlayer(id,state));
  socket.on("player:leave", (id)=>{ const p = players.get(id); if (p){ scene.remove(p.mesh); players.delete(id); } });
  socket.on("state:update", (all)=>{ for (const [id,s] of Object.entries(all)){ const p = ensurePlayer(id,s); p.mesh.position.set(s.x,s.y,s.z); p.mesh.rotation.y = s.rotY; p.hp = s.hp; } });
  function ensurePlayer(id,state){ if (!players.has(id)){ const isMe = (id===socket.id); const color = isMe ? 0x55ffaa : 0xff5555; const mesh = makeBoxer(color); scene.add(mesh); players.set(id, { mesh, hp:100 }); } return players.get(id); }
  const keys = new Set(); window.addEventListener("keydown", e=>keys.add(e.key.toLowerCase())); window.addEventListener("keyup", e=>keys.delete(e.key.toLowerCase()));
  let last = performance.now();
  function loop(now){ const dt = Math.min(0.05,(now-last)/1000); last = now; const forward = (keys.has("w")||keys.has("arrowup")?1:0) + (keys.has("s")||keys.has("arrowdown")?-1:0); const right = (keys.has("d")||keys.has("arrowright")?1:0) + (keys.has("a")||keys.has("arrowleft")?-1:0); const punch = keys.has(" "); const superSpeed = keys.has("shift"); let rotY = 0; if (forward!==0||right!==0) rotY = Math.atan2(forward, right); socket.emit("input",{ forward, right, punch, superSpeed, rotY, dt }); renderer.render(scene, camera); requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
  function resize(){ renderer.setSize(window.innerWidth, window.innerHeight, false); camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); }
  window.addEventListener("resize", resize); resize();
}
