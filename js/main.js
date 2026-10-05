// Rocket Rush: the game itself. Sets up rendering, runs matches (vs AI, split screen, online,
// free play), reads input, drives the cameras and the HUD.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { TICK, F, BALL_R, CAR, PADS, PAD_BIG_TIME, PAD_SMALL_TIME, Ball, Car, hitBall, hitCars, collectPads, predictBall, isGoal, arenaDist } from './physics.js';
import { buildArena, TEAM_COLORS, TEAM_NAMES } from './arena.js';
import { loaders, loadModels, CarView, BallView, Particles, carTrail, ballTrail, goalExplosion, demoExplosion } from './visuals.js';
import { Bot } from './ai.js';
import { Sound } from './audio.js';
import { createOnline } from './net.js';
import { initAccount, account, currentLook, renderGarage, openDrop, cloudReady, supabaseClient } from './account.js';

const $ = (sel) => document.querySelector(sel);
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

// ---------------------------------------------------------------- settings
const SETTINGS_KEY = 'rocketrush_settings_v2';
const settings = { difficulty: 'medium', teamSize: '1', minutes: '3', quality: 'high', sound: 'on', name: '' };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) { /* defaults */ }
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ } };

// ---------------------------------------------------------------- rendering
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1220);

const hemi = new THREE.HemisphereLight(0xdfeaff, 0x39502f, 0.55);
const sun = new THREE.DirectionalLight(0xfff3df, 2.6);
const SUN_OFFSET = new THREE.Vector3(2600, 5200, 1900);
sun.shadow.camera.left = sun.shadow.camera.bottom = -2600;
sun.shadow.camera.right = sun.shadow.camera.top = 2600;
sun.shadow.camera.near = 500; sun.shadow.camera.far = 12000;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 3;
scene.add(hemi, sun, sun.target);

loaders.hdr.load('assets/env/stadium_2k.hdr', (tex) => {
  tex.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = tex;
  scene.environment = tex;
  scene.backgroundIntensity = 0.85;
  scene.environmentIntensity = 0.8;
}, undefined, () => console.warn('Sky failed to load; using a plain backdrop.'));

let composer = null, bloom = null;
function applyQuality() {
  const q = settings.quality;
  const ratio = Math.min(window.devicePixelRatio || 1, q === 'high' ? 1.75 : q === 'medium' ? 1.25 : 1) * (q === 'low' ? 0.8 : 1);
  renderer.setPixelRatio(ratio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = q !== 'low';
  sun.castShadow = q !== 'low';
  sun.shadow.mapSize.setScalar(q === 'high' ? 4096 : 2048);
  sun.shadow.map?.dispose(); sun.shadow.map = null;
  scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  composer?.dispose();
  composer = null;
  if (q !== 'low') {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q === 'high' ? 4 : 2 });
    composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, rigs[0].cam));
    bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.38, 0.6, 1.0);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }
}

// ---------------------------------------------------------------- cameras
const CAM_DIST = 290, CAM_HEIGHT = 112, CAM_FOV = 72, CAM_MARGIN = 55;
function makeRig() {
  return { cam: new THREE.PerspectiveCamera(CAM_FOV, 1, 8, 140000), dir: new THREE.Vector3(0, 0, 1), ballCam: true, shake: 0, fov: CAM_FOV, lift: 0 };
}
const rigs = [makeRig(), makeRig()];
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();

function updateRig(rig, car, dt) {
  const ball = G.ball;
  // which way the camera faces: toward the ball, or where the car is going
  let lift = 0;
  if (rig.ballCam && !G.ballHidden) {
    v1.subVectors(ball.pos, car.pos);
    const flat = Math.hypot(v1.x, v1.z);
    lift = clamp(Math.atan2(v1.y, flat + 200), -0.25, 1.0);
    if (flat > 30) { v1.y = 0; v1.normalize(); } else v1.copy(rig.dir);
  } else {
    if (car.onGround && car.normal.y > 0.6) v1.copy(car.fwd);
    else if (car.vel.lengthSq() > 250 * 250) v1.copy(car.vel);
    else v1.copy(rig.dir);
    v1.y = 0;
    if (v1.lengthSq() < 0.01) v1.copy(rig.dir); else v1.normalize();
  }
  rig.dir.lerp(v1, 1 - Math.exp(-(rig.ballCam ? 9 : 8) * dt)).normalize();
  rig.lift += (lift - rig.lift) * (1 - Math.exp(-7 * dt));

  // behind and above the car; when the ball is high the camera drops and tilts up toward it
  const back = CAM_DIST * Math.cos(rig.lift * 0.5), up = CAM_HEIGHT - Math.sin(rig.lift) * 150;
  const cam = rig.cam;
  cam.position.copy(car.pos).addScaledVector(rig.dir, -back);
  cam.position.y += up;
  cam.position.x = clamp(cam.position.x, -F.HX + 40, F.HX - 40);
  cam.position.z = clamp(cam.position.z, -F.HZ - F.GD + 40, F.HZ + F.GD - 40);
  cam.position.y = clamp(cam.position.y, 22, F.H - 30);
  // never let the camera through a wall, a curve or the ceiling (this matters on the walls)
  for (let i = 0; i < 3; i++) {
    const d = arenaDist(cam.position, v3);
    if (d >= CAM_MARGIN) break;
    cam.position.addScaledVector(v3, CAM_MARGIN - d);
  }
  v2.copy(car.pos).addScaledVector(rig.dir, 420);
  v2.y += 55 + Math.sin(rig.lift) * 520;
  if (rig.shake > 0) {
    rig.shake = Math.max(0, rig.shake - dt * 1.6);
    const s = rig.shake * rig.shake * 34;
    cam.position.x += (Math.random() - 0.5) * s; cam.position.y += (Math.random() - 0.5) * s; cam.position.z += (Math.random() - 0.5) * s;
  }
  cam.lookAt(v2);
  const fov = CAM_FOV + (car.supersonic ? 7 : 0) + (car.boosting ? 3 : 0);
  rig.fov += (fov - rig.fov) * (1 - Math.exp(-4 * dt));
  if (Math.abs(cam.fov - rig.fov) > 0.01) { cam.fov = rig.fov; cam.updateProjectionMatrix(); }
}

// ---------------------------------------------------------------- input
const keys = new Set();
const mouse = [false, false, false];
const KEYS_P1 = { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], jump: ['Space'], boost: ['ShiftLeft'], slide: ['KeyF'], rollL: ['KeyQ'], rollR: ['KeyE'] };
const KEYS_SOLO = { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], jump: ['Space'], boost: ['ShiftLeft', 'ShiftRight'], slide: ['KeyF', 'ControlLeft'], rollL: ['KeyQ'], rollR: ['KeyE'] };
const KEYS_P2 = { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], jump: ['Minus', 'Numpad0'], boost: ['ShiftRight'], slide: ['Slash', 'ControlRight'], rollL: ['Comma'], rollR: ['Period'] };
const down = (codes) => codes.some((c) => keys.has(c));
const steerSmooth = [0, 0];
const PAD_SPARK = new THREE.Color(2.4, 1.3, 0.2);
const gamepads = () => (navigator.getGamepads ? [...navigator.getGamepads()] : []).filter((p) => p && p.connected);
const padPrev = [{}, {}];

function readInput(i, car, dt) {
  const inp = car.input;
  const split = G.mode === 'two';
  const map = split ? (i === 0 ? KEYS_P1 : KEYS_P2) : KEYS_SOLO;
  let throttle = (down(map.up) ? 1 : 0) - (down(map.down) ? 1 : 0);
  let steer = (down(map.right) ? 1 : 0) - (down(map.left) ? 1 : 0);
  let pitch = -throttle, roll = (down(map.rollR) ? 1 : 0) - (down(map.rollL) ? 1 : 0);
  let jump = down(map.jump), boost = down(map.boost), slide = down(map.slide);
  if (i === 0 && !split) { boost = boost || mouse[0]; slide = slide || mouse[2]; }

  // keyboard steering eases in a little, so a tap is a nudge rather than full lock
  steerSmooth[i] += (steer - steerSmooth[i]) * Math.min(1, dt * (steer === 0 || steer * steerSmooth[i] < 0 ? 12 : 4.5));
  let steerOut = Math.abs(steerSmooth[i]) < 0.01 ? 0 : steerSmooth[i];

  const pad = gamepads()[i];
  if (pad && pad.connected) {
    const dz = (v) => Math.abs(v) < 0.16 ? 0 : (v - Math.sign(v) * 0.16) / 0.84;
    const b = (n) => !!pad.buttons[n] && pad.buttons[n].pressed, val = (n) => pad.buttons[n] ? pad.buttons[n].value : 0;
    const gx = dz(pad.axes[0] || 0) + (b(15) ? 1 : 0) - (b(14) ? 1 : 0), gy = dz(pad.axes[1] || 0), gt = val(7) - val(6);
    if (Math.abs(gx) > Math.abs(steer)) { steer = gx; steerOut = gx; }
    if (Math.abs(gt) > Math.abs(throttle)) throttle = gt;
    if (gy !== 0) pitch = gy;
    jump = jump || b(0); boost = boost || b(1); slide = slide || b(2);
    roll += (b(5) ? 1 : 0) - (b(4) ? 1 : 0);
    if (b(3) && !padPrev[i].cam) toggleBallCam(i);

    padPrev[i].cam = b(3);
  }

  inp.throttle = throttle; inp.steer = steerOut; inp.pitch = pitch; inp.yaw = steer; inp.roll = roll;
  if (slide && !car.onGround) { inp.roll = roll || steer; inp.yaw = 0; }
  inp.jump = jump; inp.boost = boost; inp.slide = slide;
}

function toggleBallCam(i) {
  if (!G.playing) return;
  rigs[i].ballCam = !rigs[i].ballCam;
  Sound.click();
}

window.addEventListener('keydown', (e) => {
  const typing = e.target.tagName === 'INPUT';
  if (!typing && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash', 'Minus'].includes(e.code)) e.preventDefault();
  if (typing) return;
  keys.add(e.code);
  Sound.init(); Sound.resume();
  if (e.repeat) return;
  if (e.code === 'KeyC') toggleBallCam(0);
  if (e.code === 'Enter' && G.mode === 'two') toggleBallCam(1);
  if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); mouse.fill(false); });
canvas.addEventListener('mousedown', (e) => { mouse[e.button] = true; Sound.init(); Sound.resume(); });
window.addEventListener('mouseup', (e) => { mouse[e.button] = false; });
window.addEventListener('contextmenu', (e) => { if (G.playing) e.preventDefault(); });

// ---------------------------------------------------------------- game state
const G = {
  mode: 'attract',          // attract | single | two | online | free
  state: 'idle',            // countdown | play | goal | over
  playing: false,           // a match the player is in (as opposed to the menu backdrop)
  paused: false,
  cars: [], views: [], bots: [], locals: [],
  ball: new Ball(), ballHidden: false,
  pads: new Float32Array(PADS.length),
  score: [0, 0], timeLeft: 180, overtime: false, timeUp: false,
  countdown: 0, goalTimer: 0, kickoffTouched: false,
  prediction: [], predictAt: 0,
  time: 0, garage: false, dropAvailable: false,
  names: [...TEAM_NAMES],
};
let arena = null, ballView = null, fx = null, models = null, garageView = null;
const garageCar = new Car(0);

function clearMatch() {
  for (const v of G.views) v.dispose();
  G.cars = []; G.views = []; G.bots = []; G.locals = [];
  fx.clear();
}

function addCar(team, slot, name, look, bot) {
  const car = new Car(team, slot);
  const view = new CarView(scene, models.car, team, name);
  view.setLook(look);
  G.cars.push(car); G.views.push(view);
  if (bot) G.bots.push(new Bot(car, bot));
  return car;
}

const BOT_NAMES = ['Tex', 'Vega', 'Nova', 'Rook', 'Blitz', 'Echo', 'Jinx', 'Onyx'];

function setupMatch(mode) {
  if (mode !== 'online') { lobby?.leave(); online.active = false; }
  clearMatch();
  G.mode = mode;
  G.playing = mode !== 'attract';
  G.paused = false; G.garage = false;
  G.score = [0, 0]; G.overtime = false; G.timeUp = false; G.dropAvailable = false;
  G.timeLeft = Number(settings.minutes) * 60;
  G.names = [...TEAM_NAMES];
  const look = currentLook();
  const myName = account.user ? account.name : (settings.name || 'You');
  let names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);

  if (mode === 'attract') {
    addCar(0, 0, null, null, 'hard'); addCar(1, 0, null, null, 'hard');
  } else if (mode === 'single') {
    const n = Number(settings.teamSize);
    G.locals = [addCar(0, 0, null, look, null)];
    for (let s = 1; s < n; s++) addCar(0, s, names.pop(), null, settings.difficulty);
    for (let s = 0; s < n; s++) addCar(1, s, names.pop(), null, settings.difficulty);
  } else if (mode === 'two') {
    G.locals = [addCar(0, 0, 'P1', look, null), addCar(1, 0, 'P2', null, null)];
  } else if (mode === 'free') {
    G.locals = [addCar(0, 0, null, look, null)];
  } else if (mode === 'online') {
    const mine = online.host ? 0 : 1;
    const a = addCar(0, 0, mine === 0 ? null : online.opponent.name, mine === 0 ? look : online.opponent.look, null);
    const b = addCar(1, 0, mine === 1 ? null : online.opponent.name, mine === 1 ? look : online.opponent.look, null);
    G.locals = [mine === 0 ? a : b];
    (mine === 0 ? b : a).kinematic = true;
    G.names = mine === 0 ? [myName, online.opponent.name] : [online.opponent.name, myName];
  }
  rigs[0].ballCam = rigs[1].ballCam = true;
  for (const r of rigs) { r.shake = 0; r.lift = 0; }
  G.locals.forEach((car, i) => rigs[i].dir.set(0, 0, car.team === 0 ? 1 : -1));
  showOnly(null);
  updateHudLayout();
  onResize();
  if (mode === 'online' && !online.host) { G.state = 'countdown'; G.countdown = 3; placeKickoff(0); }   // the host's packets take it from here
  else kickoff();
}

function placeKickoff(spot) {
  for (const car of G.cars) {
    car.spawn(spot + car.slot * 2);
    if (G.mode === 'free') car.boost = 100;
  }
  G.ball.reset();
  G.ballHidden = false;
  G.pads.fill(0);
  G.kickoffSpot = spot;
}

function kickoff() {
  placeKickoff(Math.floor(Math.random() * 5));
  G.state = 'countdown';
  G.countdown = G.mode === 'attract' || G.mode === 'free' ? 1.2 : 3;
  G.kickoffTouched = false;
  online.kickSeq++;
  lastBeep = -1;
}

function scoreGoal(team, scorerLook) {
  G.score[team]++;
  startGoal(team, G.ball.pos, scorerLook);
  online.goalSeq++;
  online.lastGoal = { n: online.goalSeq, t: team, p: [Math.round(G.ball.pos.x), Math.round(G.ball.pos.y), Math.round(G.ball.pos.z)] };
}

// The show after a goal: explosion, cars thrown clear, the scoreline.
function startGoal(team, pos, celebration) {
  G.state = 'goal';
  G.goalTimer = 3.4;
  G.ballHidden = true;
  const at = pos.clone();
  if (G.mode === 'single' || G.mode === 'two' || G.mode === 'free') {
    celebration = G.locals.find((c) => c.team === team) && (G.mode !== 'two' || team === 0) ? currentLook().celebration : 'cel_classic';
  }
  goalExplosion(fx, at, team, celebration || 'cel_classic');
  for (const car of G.cars) {
    if (car.kinematic || car.demoed) continue;
    v1.subVectors(car.pos, at);
    const d = v1.length();
    if (d > 2600) continue;
    v1.y = Math.abs(v1.y) + d * 0.45;
    car.vel.addScaledVector(v1.normalize(), 2100 * (1 - d / 2600));
    car.groundGrace = 0.25;
    car.ang.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
  }
  for (const r of rigs) r.shake = 1;
  if (G.playing) {
    Sound.goal();
    const el = $('#goalMsg');
    el.textContent = 'GOAL!';
    el.className = team === 0 ? 'blue' : 'red';
    showSub(`${G.names[team]} scored`);
  }
}

function showSub(text) {
  const el = $('#subMsg');
  el.textContent = text || '';
  el.classList.toggle('hidden', !text);
}

function finishMatch() {
  G.state = 'over';
  const [b, r] = G.score;
  const winner = b > r ? 0 : 1;
  const mine = G.locals[0]?.team ?? 0;
  const won = winner === mine;
  G.dropAvailable = won && ((G.mode === 'single' && settings.difficulty === 'hard') || G.mode === 'online');
  $('#overTitle').textContent = G.mode === 'two' ? `${TEAM_NAMES[winner]} WINS` : won ? 'VICTORY' : 'DEFEAT';
  $('#overSub').textContent = `${G.names[0]} ${b} – ${r} ${G.names[1]}`;
  $('#btnRematch').textContent = G.mode === 'online' ? 'Find New Match' : 'Rematch';
  $('#btnOpenDrop').classList.toggle('hidden', !G.dropAvailable);
  $('#goalMsg').classList.add('hidden'); showSub('');
  if (G.playing) showOnly('#menuOver');
}

// ---------------------------------------------------------------- online sync
// The host (blue) owns the clock, score, goals and the ball. The guest (orange) simulates the
// ball too, so its own touches feel instant, reports those touches to the host, and otherwise
// eases its ball toward the host's. Each side owns its own car; the other car is drawn from
// packets, carried forward by its velocity so it glides between them.
const SEND_MS = 66;
const online = {
  session: null, active: false, host: false, opponent: null,
  kickSeq: 0, goalSeq: 0, lastGoal: null,
  lastSend: 0, seq: 0, remote: null, remoteAt: 0, rtt: 120, theirTs: 0, theirTsAt: 0,
  hitSeq: 0, hitAt: 0, hitBall: null, hitAck: 0, seenHit: 0,
  seenKick: -1, seenGoal: 0, netBall: new Ball(), haveNetBall: false,
  picks: [], pickSeq: 0, seenPick: 0,
};
const r1 = (v) => Math.round(v * 10) / 10, r3 = (v) => Math.round(v * 1000) / 1000;
const packBall = (b) => [r1(b.pos.x), r1(b.pos.y), r1(b.pos.z), r1(b.vel.x), r1(b.vel.y), r1(b.vel.z), r3(b.ang.x), r3(b.ang.y), r3(b.ang.z)];
function unpackBall(a, b) { b.pos.set(a[0], a[1], a[2]); b.vel.set(a[3], a[4], a[5]); b.ang.set(a[6], a[7], a[8]); }

function resetOnline() {
  Object.assign(online, { kickSeq: 0, goalSeq: 0, lastGoal: null, lastSend: 0, seq: 0, remote: null, rtt: 120, theirTs: 0, hitSeq: 0, hitAck: 0, seenHit: 0, hitBall: null, seenKick: -1, seenGoal: 0, haveNetBall: false, picks: [], pickSeq: 0, seenPick: 0 });
}

function netSend(now) {
  if (now - online.lastSend < SEND_MS) return;
  online.lastSend = now;
  const car = G.locals[0], q = car.quat;
  const p = {
    n: ++online.seq, ts: Math.round(now), e: [online.theirTs, Math.round(now - online.theirTsAt)],
    c: [r1(car.pos.x), r1(car.pos.y), r1(car.pos.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w), r1(car.vel.x), r1(car.vel.y), r1(car.vel.z), r3(car.ang.x), r3(car.ang.y), r3(car.ang.z),
      Math.round(car.boost), (car.boosting ? 1 : 0) | (car.onGround ? 2 : 0) | (car.supersonic ? 4 : 0) | (car.demoed ? 8 : 0), r3(car.steerAngle)],
  };
  online.picks = online.picks.filter((k) => now - k.at < 700);
  if (online.picks.length) p.pk = online.picks.map((k) => [k.i, k.n]);
  if (online.host) {
    p.b = packBall(G.ball);
    p.st = [G.state, G.score[0], G.score[1], Math.round(G.timeLeft * 10) / 10, r1(G.countdown), G.overtime ? 1 : 0, G.ballHidden ? 1 : 0];
    p.k = [online.kickSeq, G.kickoffSpot];
    if (online.lastGoal) p.g = { ...online.lastGoal, c: currentLook().celebration };
    p.ha = online.seenHit;
  } else {
    if (online.hitBall && now - online.hitAt < 400) p.h = { n: online.hitSeq, b: online.hitBall };
    p.cel = currentLook().celebration;
  }
  lobby.sendState(p);
}

function netReceive(p) {
  if (!online.active || G.mode !== 'online') return;
  const now = performance.now();
  if (online.remote && p.n <= online.remote.n) return;   // out of order
  online.remote = p; online.remoteAt = now;
  online.theirTs = p.ts; online.theirTsAt = now;
  if (p.e && p.e[0]) online.rtt += (clamp(now - p.e[0] - p.e[1], 0, 600) - online.rtt) * 0.15;
  const lag = Math.min(0.2, online.rtt / 2000);

  if (p.pk) for (const [i, n] of p.pk) if (n > online.seenPick) { online.seenPick = n; G.pads[i] = PADS[i][2] ? PAD_BIG_TIME : PAD_SMALL_TIME; }

  if (online.host) {
    online.guestCel = p.cel;
    if (p.h && p.h.n > online.seenHit && G.state === 'play') {
      // the guest touched the ball: take their result, carried forward to now
      online.seenHit = p.h.n;
      unpackBall(p.h.b, G.ball);
      for (let t = 0; t < lag; t += TICK) G.ball.step(TICK);
      G.kickoffTouched = true;
    }
    return;
  }

  // ---- guest: follow the host's match
  const [state, sb, sr, tl, cd, ot, hidden] = p.st;
  G.score[0] = sb; G.score[1] = sr; G.timeLeft = tl; G.overtime = !!ot;
  if (p.k[0] !== online.seenKick) {
    online.seenKick = p.k[0];
    placeKickoff(p.k[1]);
    G.state = 'countdown'; G.countdown = cd; lastBeep = -1;
    $('#goalMsg').classList.add('hidden'); showSub('');
  }
  if (p.g && p.g.n > online.seenGoal) {
    online.seenGoal = p.g.n;
    startGoal(p.g.t, v3.set(p.g.p[0], p.g.p[1], p.g.p[2]), p.g.t === 0 ? p.g.c : currentLook().celebration);
  }
  if (state === 'countdown' && G.state === 'countdown') G.countdown = cd;
  if (state === 'play' && G.state !== 'play' && (G.state !== 'goal' || !hidden)) { G.state = 'play'; G.ballHidden = false; }
  if (state === 'over' && G.state !== 'over') finishMatch();
  online.hitAck = p.ha || 0;
  unpackBall(p.b, online.netBall);
  for (let t = 0; t < lag; t += TICK) online.netBall.step(TICK);
  online.haveNetBall = true;
}

// Moves the other player's car to where its last packet says it should be by now.
const rq = new THREE.Quaternion();
function driveRemote(car, dt) {
  const p = online.remote;
  if (!p) return;
  const c = p.c, age = Math.min(0.25, (performance.now() - online.remoteAt) / 1000 + online.rtt / 2000);
  const wasDemoed = car.demoed;
  car.demoed = !!(c[14] & 8);
  if (car.demoed && !wasDemoed) { demoExplosion(fx, car.pos, car.team); Sound.demo(); }
  car.vel.set(c[7], c[8], c[9]); car.ang.set(c[10], c[11], c[12]);
  v1.set(c[0] + c[7] * age, c[1] + c[8] * age, c[2] + c[9] * age);
  if (v1.distanceToSquared(car.pos) > 900 * 900 || wasDemoed) car.pos.copy(v1);
  else car.pos.lerp(v1, 1 - Math.exp(-20 * dt));
  car.quat.slerp(rq.set(c[3], c[4], c[5], c[6]).normalize(), 1 - Math.exp(-18 * dt));
  car.boost = c[13];
  car.boosting = !!(c[14] & 1); car.onGround = !!(c[14] & 2); car.supersonic = !!(c[14] & 4);
  car.steerAngle = c[15];
  car.wheelSpin += car.vel.dot(car.fwd) * dt / 17;
  car.updateAxes();
}

// ---------------------------------------------------------------- one physics tick
let lastBeep = -1;
const world = { ball: G.ball, cars: G.cars, prediction: G.prediction, pads: G.pads, kickoff: false, frozen: false };

function tick(dt) {
  const { ball, cars } = G;
  G.time += dt;
  const guest = G.mode === 'online' && !online.host;
  const frozen = G.state === 'countdown';

  if (frozen && !guest) {
    G.countdown -= dt;
    if (G.countdown <= 0) { G.state = 'play'; if (G.playing) Sound.countdownBeep(true); }
  }
  if (frozen && G.playing) {
    const n = Math.ceil(G.countdown);
    if (n !== lastBeep && n > 0 && n <= 3) { lastBeep = n; Sound.countdownBeep(false); }
  }

  // bots look ahead along the ball's path, refreshed a few times a second
  if (G.bots.length && G.time >= G.predictAt) {
    G.predictAt = G.time + 0.1;
    predictBall(ball, G.prediction, 100);
  }
  world.cars = cars; world.kickoff = !G.kickoffTouched && G.state !== 'goal'; world.frozen = frozen;

  if (!frozen) {
    for (const bot of G.bots) bot.update(dt, world);
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      if (car.kinematic) { driveRemote(car, dt); continue; }
      if (G.mode === 'free') car.boost = 100;
      car.step(dt);
      if (car.event && G.locals.includes(car)) {
        if (car.event === 'jump') Sound.jump(); else if (car.event === 'dodge') Sound.dodge(); else if (car.event === 'land' && car.airTime === 0) Sound.land();
      }
    }
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j], aWas = a.demoed, bWas = b.demoed;
      const hit = hitCars(a, b);
      if (hit === 'demo') {
        const victim = a.demoed && !aWas ? a : b;
        demoExplosion(fx, victim.pos, victim.team);
        if (G.playing) Sound.demo();
      } else if (hit === 'bump' && G.playing && (G.locals.includes(a) || G.locals.includes(b))) Sound.bump();
    }
  }

  if (!G.ballHidden) {
    if (!frozen) {
      const impact = ball.step(dt);
      if (impact > 120 && G.playing) Sound.bounce(impact);
      for (const car of cars) {
        const power = hitBall(car, ball);
        if (power <= 0) continue;
        G.kickoffTouched = true;
        G.lastTouch = car;
        if (G.playing && power > 60) Sound.hit(power);
        if (guest && car === G.locals[0]) { online.hitSeq++; online.hitAt = performance.now(); online.hitBall = packBall(ball); }
      }
      if (guest) reconcileBall(dt);
    }
    if (!guest && G.state === 'play') {
      const scored = isGoal(ball);
      if (scored >= 0) scoreGoal(scored, G.mode === 'online' ? (scored === 0 ? currentLook().celebration : online.guestCel) : null);
    }
  }

  if (!frozen) {
    for (let i = 0; i < G.pads.length; i++) if (G.pads[i] > 0) G.pads[i] = Math.max(0, G.pads[i] - dt);
    for (const car of cars) {
      if (car.kinematic) continue;
      collectPads(car, G.pads, (i, big, c) => {
        fx.burst(v1.set(PADS[i][0], big ? 90 : 20, PADS[i][1]), big ? 70 : 20, big ? 800 : 380, 0.55, big ? 40 : 26, PAD_SPARK, -250, 150);
        if (big) fx.shock(v1, PAD_SPARK, 320, 0.35);
        if (G.locals.includes(c)) { Sound.pad(big); if (G.mode === 'online') online.picks.push({ i, n: ++online.pickSeq, at: performance.now() }); }
      });
    }
  }

  if (guest) { if (G.state === 'goal') G.goalTimer -= dt; return; }

  // ---- the clock and what follows a goal (host or offline)
  if (G.state === 'play' && G.mode !== 'attract' && G.mode !== 'free') {
    if (!G.overtime && !G.timeUp) {
      G.timeLeft -= dt;
      if (G.timeLeft <= 0) { G.timeLeft = 0; G.timeUp = true; }
    }
    // at 0:00 play carries on until the ball touches the ground
    if (G.timeUp && ball.touchedGround) {
      G.timeUp = false;
      if (G.score[0] === G.score[1]) { G.overtime = true; kickoff(); if (G.playing) showSub('Overtime: next goal wins'); }
      else finishMatch();
    }
  } else if (G.state === 'goal') {
    G.goalTimer -= dt;
    if (G.goalTimer <= 0) {
      $('#goalMsg').classList.add('hidden'); showSub('');
      const decided = G.mode !== 'attract' && G.mode !== 'free' && (G.overtime || G.timeUp) && G.score[0] !== G.score[1];
      if (decided) finishMatch();
      else if (G.timeUp) { G.timeUp = false; G.overtime = true; kickoff(); showSub('Overtime: next goal wins'); }
      else kickoff();
    }
  }
}

// Guest only: ease the local ball toward the host's, unless we have just touched it ourselves
// and the host hasn't caught up with that touch yet.
function reconcileBall(dt) {
  if (!online.haveNetBall) return;
  const nb = online.netBall, ball = G.ball;
  nb.step(dt);
  if (online.hitSeq > online.hitAck && performance.now() - online.hitAt < 1000) return;
  const gap = nb.pos.distanceTo(ball.pos);
  if (gap > 700) { ball.copy(nb); return; }
  const k = 1 - Math.exp(-(gap > 150 ? 14 : 7) * dt);
  ball.pos.lerp(nb.pos, k); ball.vel.lerp(nb.vel, k); ball.ang.lerp(nb.ang, k);
}

// ---------------------------------------------------------------- HUD
const hud = { b: -1, r: -1, clock: '', boost: [-1, -1], cd: '', cam: '', sup: null };
function fmtTime(t) {
  t = Math.max(0, Math.ceil(t));
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
}
function updateHudLayout() {
  const play = G.playing;
  $('#topBar').classList.toggle('hidden', !play || G.mode === 'free');
  $('#camBox').classList.toggle('hidden', !play || G.mode === 'two');
  $('#boostP1').classList.toggle('hidden', !play || G.mode === 'free');
  $('#boostP2').classList.toggle('hidden', G.mode !== 'two');
  $('#splitLine').classList.toggle('hidden', G.mode !== 'two');
  $('#accountChip').classList.toggle('hidden', play);
  $('#nameBlue').textContent = G.names[0]; $('#nameRed').textContent = G.names[1];
  if (!play) { for (const id of ['#countdownNum', '#goalMsg', '#subMsg', '#superTag']) $(id).classList.add('hidden'); }
  Object.assign(hud, { b: -1, r: -1, clock: '', boost: [-1, -1], cd: null, cam: '', sup: null });
}
function syncHud() {
  if (!G.playing) return;
  if (hud.b !== G.score[0]) { hud.b = G.score[0]; $('#scoreBlue').textContent = hud.b; }
  if (hud.r !== G.score[1]) { hud.r = G.score[1]; $('#scoreRed').textContent = hud.r; }
  const clock = G.overtime ? 'OVERTIME' : fmtTime(G.timeLeft);
  if (hud.clock !== clock) { hud.clock = clock; $('#timerBox').textContent = clock; $('#timerBox').classList.toggle('overtime', G.overtime); }
  // in split screen blue (P1) is on the left, so the gauges swap sides
  G.locals.forEach((car, i) => {
    const b = Math.round(car.boost);
    if (hud.boost[i] === b) return;
    hud.boost[i] = b;
    const el = G.mode === 'two' ? (i === 0 ? $('#boostP2') : $('#boostP1')) : $('#boostP1');
    el.style.setProperty('--p', b);
    el.querySelector('.boostNum').textContent = b;
  });
  const cd = G.state === 'countdown' && G.mode !== 'free' ? String(Math.max(1, Math.ceil(G.countdown))) : G.state === 'play' && G.time - G.goAt < 0.8 ? 'GO!' : '';
  if (hud.cd !== cd) {
    if (hud.cd && hud.cd !== 'GO!' && cd === '' && G.state === 'play') { G.goAt = G.time; return; }
    hud.cd = cd;
    const el = $('#countdownNum');
    el.textContent = cd;
    el.classList.add('hidden');
    if (cd) { void el.offsetWidth; el.classList.remove('hidden'); }
  }
  if (G.state === 'goal') $('#goalMsg').classList.remove('hidden');
  const cam = rigs[0].ballCam ? 'BALL CAM' : 'CAR CAM';
  if (hud.cam !== cam) { hud.cam = cam; $('#camBoxLabel').textContent = cam; }
  const sup = G.mode !== 'two' && !!G.locals[0]?.supersonic;
  if (hud.sup !== sup) { hud.sup = sup; $('#superTag').classList.toggle('hidden', !sup); }
}

// ---------------------------------------------------------------- menus
const MENUS = ['#menuLoading', '#menuMain', '#menuHow', '#menuSettings', '#menuPause', '#menuOver', '#menuGarage', '#menuDrop', '#menuLogin', '#menuOnline', '#menuLobby', '#menuNotice'];
function showOnly(sel) {
  for (const m of MENUS) $(m).classList.toggle('hidden', m !== sel);
  $('#accountChip').classList.toggle('hidden', sel !== '#menuMain');
}
function showNotice(title, body) {
  $('#noticeTitle').textContent = title;
  $('#noticeBody').textContent = body;
  showOnly('#menuNotice');
}
function goToMenu() {
  lobby?.leave(); online.active = false;
  G.garage = false;
  if (G.mode !== 'attract') setupMatch('attract');
  updateHudLayout();
  showOnly('#menuMain');
}
function togglePause() {
  if (!G.playing || G.state === 'over') return;
  G.paused = !G.paused;
  showOnly(G.paused ? '#menuPause' : null);
}
const click = (sel, fn) => $(sel).addEventListener('click', () => { Sound.init(); Sound.resume(); Sound.click(); fn(); });

function wireMenus() {
  click('#btnPlay', () => setupMatch('single'));
  click('#btn2p', () => setupMatch('two'));
  click('#btnFree', () => setupMatch('free'));
  click('#btnHow', () => showOnly('#menuHow'));
  click('#closeHow', () => showOnly('#menuMain'));
  click('#btnSettings', () => showOnly('#menuSettings'));
  click('#closeSettings', () => showOnly('#menuMain'));
  click('#btnResume', togglePause);
  click('#btnQuit', goToMenu);
  click('#btnMainMenu', goToMenu);
  click('#noticeOk', goToMenu);
  click('#btnRematch', () => { if (G.mode === 'online') { goToMenu(); startOnline('quick'); } else setupMatch(G.mode); });
  click('#btnGarage', () => { G.garage = true; showOnly('#menuGarage'); renderGarage(); garageView.setLook(currentLook()); });
  click('#closeGarage', () => { G.garage = false; showOnly('#menuMain'); });
  click('#btnOpenDrop', openDrop);
  click('#btnDropContinue', () => { G.dropAvailable = false; goToMenu(); });

  document.querySelectorAll('.diffRow[data-setting]').forEach((row) => {
    const key = row.dataset.setting;
    const mark = () => row.querySelectorAll('.diffBtn').forEach((b) => b.classList.toggle('active', b.dataset.v === settings[key]));
    mark();
    row.querySelectorAll('.diffBtn').forEach((b) => b.addEventListener('click', () => {
      settings[key] = b.dataset.v;
      saveSettings(); mark();
      if (key === 'sound') Sound.setEnabled(settings.sound === 'on');
      if (key === 'quality') applyQuality();
      Sound.click();
    }));
  });
  Sound.setEnabled(settings.sound === 'on');

  // online
  click('#btnOnline', () => {
    if (!cloudReady) return showNotice('Online unavailable', 'The online service could not be loaded. Check your connection (or an ad blocker) and reload the page.');
    $('#onlineName').value = account.user ? account.name : settings.name;
    showOnly('#menuOnline');
  });
  click('#closeOnline', () => showOnly('#menuMain'));
  click('#btnQuick', () => startOnline('quick'));
  click('#btnCreateRoom', () => startOnline('create'));
  click('#btnJoinRoom', () => {
    const code = $('#joinCode').value.trim();
    if (code.length !== 4) { $('#joinCode').focus(); return; }
    startOnline('join', code);
  });
  $('#joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnJoinRoom').click(); });
  click('#btnCancelLobby', goToMenu);
}

let lobby = null;
function startOnline(kind, code) {
  const typed = $('#onlineName').value.trim().slice(0, 18);
  if (typed) { settings.name = typed; saveSettings(); }
  const name = typed || (account.user ? account.name : '') || 'Player ' + Math.floor(100 + Math.random() * 900);
  const { celebration, ...look } = currentLook();
  lobby = lobby || createOnline(supabaseClient, {
    onRoom(room) {
      if (G.mode === 'online') return;
      $('#lobbyWord1').textContent = room.code ? 'PRIVATE' : 'FINDING';
      $('#lobbyWord2').textContent = room.code ? 'ROOM' : 'MATCH';
      $('#roomCode').textContent = room.code || '';
      $('#roomCode').classList.toggle('hidden', !room.code);
      $('#lobbyStatus').textContent = room.status;
      $('#lobbyPlayers').innerHTML = '';
      for (const p of room.players) {
        const el = document.createElement('span');
        el.textContent = p.name + (p.me ? ' (you)' : '');
        if (p.me) el.className = 'me';
        $('#lobbyPlayers').appendChild(el);
      }
    },
    onError(text) { lobby.leave(); online.active = false; showNotice('Online', text); },
    onStart({ host, opponent }) {
      resetOnline();
      online.active = true; online.host = host; online.opponent = { name: opponent.name || 'Opponent', look: opponent.look || null };
      setupMatch('online');
    },
    onPacket: netReceive,
    onPeerLeft() {
      if (G.mode !== 'online' || G.state === 'over') return;
      lobby.leave(); online.active = false;
      setupMatch('attract'); updateHudLayout();
      showNotice('Opponent left', 'The other player disconnected. The match has ended.');
    },
  });

  showOnly('#menuLobby');
  $('#roomCode').classList.add('hidden'); $('#lobbyPlayers').innerHTML = ''; $('#lobbyStatus').textContent = 'Connecting…';
  if (kind === 'quick') lobby.quick({ name, look });
  else if (kind === 'create') lobby.create({ name, look });
  else lobby.join(code, { name, look });
}

// ---------------------------------------------------------------- frame loop
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  const size = renderer.getDrawingBufferSize(v2size);
  composer?.setSize(size.x, size.y);
  const split = G.mode === 'two';
  for (const r of rigs) { r.cam.aspect = (split ? w / 2 : w) / h; r.cam.updateProjectionMatrix(); }
}
const v2size = new THREE.Vector2();
window.addEventListener('resize', onResize);

let last = performance.now(), acc = 0, fpsT = 0, fpsN = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const running = !(G.paused && G.mode !== 'online') && !G.garage && G.state !== 'idle';

  if (running) {
    G.locals.forEach((car, i) => readInput(i, car, dt));
    acc += dt;
    let n = 0;
    while (acc >= TICK && n++ < 10) { tick(TICK); acc -= TICK; }
    if (acc > TICK) acc = 0;
    if (G.mode === 'online' && online.active) netSend(now);
  }

  // ---- views
  const t = now / 1000;
  if (G.garage) {
    for (const v of G.views) { v.group.visible = false; if (v.tag) v.tag.visible = false; }
    ballView.mesh.visible = ballView.ring.visible = false;
    garageCar.boosting = true;
    garageView.update(garageCar, t, false);
    carTrail(fx, garageCar, garageView, dt);
    const a = t * 0.35;
    rigs[0].cam.position.set(Math.sin(a) * 250 - 60, 95, Math.cos(a) * 250);
    if (rigs[0].cam.fov !== 50) { rigs[0].cam.fov = 50; rigs[0].cam.updateProjectionMatrix(); }
    rigs[0].cam.lookAt(-10, 25, 0);
  } else {
    garageView.group.visible = false;
    for (let i = 0; i < G.cars.length; i++) {
      G.views[i].update(G.cars[i], t, true);
      if (running) carTrail(fx, G.cars[i], G.views[i], dt);
    }
    ballView.mesh.visible = !G.ballHidden;
    ballView.update(G.ball);
    if (G.ballHidden) ballView.ring.visible = false;
    else if (running) ballTrail(fx, G.ball);
    if (G.playing) G.locals.forEach((car, i) => updateRig(rigs[i], car, dt));
    else {
      // menu backdrop: a slow orbit that keeps the ball in view
      const a = t * 0.07, cam = rigs[0].cam;
      cam.position.set(Math.sin(a) * 5200, 1500, Math.cos(a) * 4300);
      v1.copy(G.ball.pos).multiplyScalar(0.6); v1.y = 150 + G.ball.pos.y * 0.3;
      menuLook.lerp(v1, 1 - Math.exp(-2 * dt));
      cam.lookAt(menuLook);
      if (cam.fov !== 50) { cam.fov = 50; cam.updateProjectionMatrix(); }
    }
  }
  arena.update(dt, G.garage ? null : G.pads);
  fx.update(dt, rigs[0].cam, renderer.domElement.height);
  syncHud();
  padMenu(now);
  const local = G.locals[0];
  Sound.drive(local ? local.vel.length() : 0, !!local?.boosting && !local.demoed, G.playing && running && G.state !== 'over' && !G.paused);

  // the shadow follows the action, snapped to its own texels so it doesn't shimmer
  const focus = G.garage ? v1.set(0, 0, 0) : G.playing && local ? local.pos : G.ball.pos;
  const snap = 5200 / sun.shadow.mapSize.x * 4;
  sun.target.position.set(Math.round(focus.x / snap) * snap, 0, Math.round(focus.z / snap) * snap);
  sun.position.copy(sun.target.position).add(SUN_OFFSET);

  // ---- draw
  if (G.mode === 'two' && G.playing) {
    const w = renderer.domElement.width, h = renderer.domElement.height, pr = renderer.getPixelRatio();
    renderer.setScissorTest(true);
    for (let i = 0; i < 2; i++) {
      if (G.views[i]?.tag) G.views[i].tag.visible = false;
      if (G.views[1 - i]?.tag) G.views[1 - i].tag.visible = !G.cars[1 - i].demoed;
      const x = i === 0 ? 0 : Math.floor(w / 2);
      renderer.setViewport(x / pr, 0, w / 2 / pr, h / pr);
      renderer.setScissor(x / pr, 0, w / 2 / pr, h / pr);
      renderer.render(scene, rigs[i].cam);
    }
    renderer.setScissorTest(false);
  } else {
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    if (composer) composer.render(dt); else renderer.render(scene, rigs[0].cam);
  }

  fpsN++; fpsT += dt;
  if (fpsT >= 1) { $('#fpsNote').textContent = Math.round(fpsN / fpsT) + ' fps' + (G.mode === 'online' && online.active ? ` · ${Math.round(online.rtt)} ms` : ''); fpsN = 0; fpsT = 0; }
}
const menuLook = new THREE.Vector3(0, 150, 0);

// ---------------------------------------------------------------- start
async function start() {
  wireMenus();
  initAccount({
    show: showOnly,
    toMenu: () => showOnly('#menuMain'),
    lookChanged: () => { garageView?.setLook(currentLook()); },
    loggedOut: () => { if (G.mode === 'online' || lobby?.active) goToMenu(); },
  });
  models = await loadModels();
  arena = buildArena(scene, loaders);
  ballView = new BallView(scene, models.ball);
  fx = new Particles(scene);
  garageView = new CarView(scene, models.car, 0, null);
  garageView.setLook(currentLook());
  garageCar.place(-60, 0, 0);
  garageCar.pos.y = CAR.REST;
  applyQuality();
  setupMatch('attract');
  showOnly('#menuMain');
  requestAnimationFrame(frame);
  // development helpers: ?auto=single|two|free starts a match straight away, ?bot=1 lets a
  // bot drive your car, ?sim=60 fast-forwards that many seconds, logging the state as it goes
  const query = new URLSearchParams(location.search);
  if (query.get('auto')) {
    setupMatch(query.get('auto'));
    if (query.get('bot')) G.bots.push(new Bot(G.locals[0], 'hard'));
    if (query.get('cam')) rigs[0].ballCam = false;
  }
  if (query.get('garage')) {
    $('#btnGarage').click();
  }
  if (query.get('sim')) {
    // fast-forward: run this many seconds of the match before the first frame is drawn
    const log = () => {
      const f = (v) => [Math.round(v.x), Math.round(v.y), Math.round(v.z)];
      console.log('RR ' + JSON.stringify({ t: Math.round(G.time), s: G.state, sc: G.score, tl: Math.round(G.timeLeft), ball: f(G.ball.pos), bv: Math.round(G.ball.vel.length()),
        cars: G.cars.map((c) => ({ p: f(c.pos), v: Math.round(c.vel.length()), g: c.onGround, up: Math.round(c.up.y * 100) / 100, b: Math.round(c.boost), d: c.demoed })) }));
    };
    const every = 120 * (Number(query.get('every')) || 1);
    for (let i = 0; i < Number(query.get('sim')) * 120; i++) {
      tick(TICK);
      if (i % every === 0) log();
    }
    log();
  }
}
start().catch((err) => {
  console.error(err);
  $('#menuLoading .tag').textContent = 'Could not start the game: ' + (err.message || err);
});

// for debugging in the console
window.RR = { G, online, rigs, renderer, scene, settings };

// ---------------------------------------------------------------- menus with a controller
// Stick or D-pad moves the highlight, A presses it, B goes back, Start resumes.
let padFocus = null, padNavAt = 0;
const padWas = { a: false, b: false, start: false };
function padMenu(now) {
  const pad = gamepads()[0];
  if (!pad) return;
  const b = (n) => !!pad.buttons[n] && pad.buttons[n].pressed;
  const menu = MENUS.map($).find((m) => !m.classList.contains('hidden'));
  if (menu && menu.id !== 'menuLoading') {
    const items = [...menu.querySelectorAll('.btn, .diffBtn, .garageTab, .itemCard.owned, .dropCrate')].filter((e) => e.offsetParent !== null);
    if (items.length) {
      let at = items.indexOf(padFocus);
      const focus = (i) => {
        padFocus?.classList.remove('padFocus');
        padFocus = items[(i + items.length) % items.length];
        padFocus.classList.add('padFocus');
        padFocus.scrollIntoView({ block: 'nearest' });
      };
      if (at < 0) focus(at = 0);
      const dir = (pad.axes[1] > 0.55 || b(13) || pad.axes[0] > 0.55 || b(15) ? 1 : 0) - (pad.axes[1] < -0.55 || b(12) || pad.axes[0] < -0.55 || b(14) ? 1 : 0);
      if (!dir) padNavAt = 0;
      else if (now >= padNavAt) { padNavAt = now + (padNavAt ? 150 : 320); focus(at + dir); }
      if (b(0) && !padWas.a) { Sound.init(); Sound.resume(); padFocus.click(); }
      if (b(1) && !padWas.b) menu.querySelector('[id^="close"], #btnCancelLobby, #btnResume, #noticeOk, #btnMainMenu')?.click();
    }
  }
  if (b(9) && !padWas.start) togglePause();
  padWas.a = b(0); padWas.b = b(1); padWas.start = b(9);
}
window.addEventListener('gamepadconnected', () => { $('#fpsNote').textContent = 'Controller connected'; });
