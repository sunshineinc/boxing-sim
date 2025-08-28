import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
const socket = io();
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b0e13);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 100); camera.position.set(0,7,10); camera.lookAt(0,0,0);
scene.add(new THREE.DirectionalLight(0xffffff,1.0)); scene.add(new THREE.AmbientLight(0xffffff,0.4));
const ring = new THREE.Mesh(new THREE.BoxGeometry(18,0.5,18), new THREE.MeshPhongMaterial({ color:0x203040 })); ring.position.y = -0.25; scene.add(ring);
const players = new Map();
function makeBoxer(color=0xff5555){ const g = new THREE.Group(); const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35,1.0,6,12), new THREE.MeshPhongMaterial({ color })); body.position.y = 1.0; g.add(body); const gloveL = new THREE.Mesh(new THREE.SphereGeometry(0.2,16,16), new THREE.MeshPhongMaterial({ color:0xaa0000 })); const gloveR = gloveL.clone(); gloveL.position.set(-0.45,1.0,0.1); gloveR.position.set(0.45,1.0,0.1); g.add(gloveL,gloveR); return g; }
function ensurePlayer(id, state){ if (!players.has(id)){ const isMe = (id === socket.id); const mesh = makeBoxer(isMe?0x55ffaa:0xff5555); scene.add(mesh); players.set(id, { mesh, hp: state.hp }); } return players.get(id); }
socket.on('state:init', (all) => { for (const [id,s] of Object.entries(all)) ensurePlayer(id,s); });
socket.on('player:join', ({id,state})=> ensurePlayer(id,state));
socket.on('player:leave', id => { const p = players.get(id); if (p){ scene.remove(p.mesh); players.delete(id);} });
socket.on('state:update', (all) => { for (const [id,s] of Object.entries(all)){ const p = ensurePlayer(id,s); p.mesh.position.set(s.x,s.y,s.z); p.mesh.rotation.y = s.rotY; p.hp = s.hp; } });
const keys = new Set(); window.addEventListener('keydown', e=> keys.add(e.key.toLowerCase())); window.addEventListener('keyup', e=> keys.delete(e.key.toLowerCase()));
let last = performance.now();
function loop(now){ const dt = Math.min(0.05,(now-last)/1000); last = now; const forward = (keys.has('w')||keys.has('arrowup')?1:0) + (keys.has('s')||keys.has('arrowdown')?-1:0); const right = (keys.has('d')||keys.has('arrowright')?1:0) + (keys.has('a')||keys.has('arrowleft')?-1:0); const punch = keys.has(' '); let rotY = 0; if (forward!==0||right!==0) rotY = Math.atan2(forward, right); socket.emit('input',{ forward, right, punch, rotY, dt }); renderer.setSize(window.innerWidth, window.innerHeight, false); renderer.render(scene, camera); requestAnimationFrame(loop); }
requestAnimationFrame(loop);
document.getElementById('join').onclick = ()=>{ const nick = document.getElementById('nick').value.trim(); socket.emit('auth', { nickname: nick }); document.getElementById('login').style.display = 'none'; document.getElementById('info').style.display = 'block'; document.getElementById('me').textContent = 'Você: ' + (nick || ('Player-' + socket.id.slice(0,4))); };
