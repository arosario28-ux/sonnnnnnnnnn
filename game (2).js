(function(){
'use strict';

/* =========================================================================
   ROCKET RUSH — original 2D arcade car-soccer game
   Single-file HTML5 canvas implementation. All art is drawn procedurally,
   all audio is synthesized with the WebAudio API. No external assets.
   ========================================================================= */

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
// Cap the backing-store pixel ratio. On 2x/3x (Retina/high-DPI) screens the
// canvas was being rendered at 4x-9x the actual pixel count with no visible
// benefit at game resolution -- this was the single biggest framerate cost.
let renderDPR = 1;
function resize(){
  renderDPR = Math.min(window.devicePixelRatio||1, 1.75);
  canvas.width = window.innerWidth * renderDPR;
  canvas.height = window.innerHeight * renderDPR;
  canvas.style.width = window.innerWidth+'px';
  canvas.style.height = window.innerHeight+'px';
}
window.addEventListener('resize', resize);
resize();

/* ---------------------------- Audio engine ----------------------------- */
const Audio1 = {
  ctx:null, enabled:true, master:null,
  init(){
    if(this.ctx) return;
    try{
      this.ctx = new (window.AudioContext||window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }catch(e){ this.enabled=false; }
  },
  resume(){ if(this.ctx && this.ctx.state==='suspended') this.ctx.resume(); },
  tone(freq, dur, type, gainVal, glideTo){
    if(!this.enabled || !this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type||'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if(glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20,glideTo), t0+dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gainVal||0.3, t0+0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0+dur+0.02);
  },
  noiseBurst(dur, gainVal, filterFreq){
    if(!this.enabled || !this.ctx) return;
    const t0 = this.ctx.currentTime;
    const bufferSize = this.ctx.sampleRate * dur;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for(let i=0;i<bufferSize;i++) data[i] = (Math.random()*2-1) * (1 - i/bufferSize);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = filterFreq||1200;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainVal||0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start(t0);
  },
  jump(){ this.tone(420,0.14,'square',0.18,700); },
  land(){ this.noiseBurst(0.10,0.22,220); },
  boostStart(){ this.tone(180,0.35,'sawtooth',0.12,520); },
  hit(speedFactor){ this.noiseBurst(0.12, 0.15+0.25*Math.min(1,speedFactor), 900+speedFactor*1400); this.tone(120+speedFactor*220,0.09,'triangle',0.12); },
  bounce(){ this.noiseBurst(0.08,0.14,500); },
  pad(big){ this.tone(big?300:500,0.18,'square',0.18,big?900:1000); },
  goal(){
    const notes=[440,554,659,880];
    notes.forEach((n,i)=> setTimeout(()=>this.tone(n,0.35,'sawtooth',0.22),i*90));
  },
  countdownBeep(final){ this.tone(final?880:520, final?0.4:0.14, 'square', 0.2); },
  click(){ this.tone(700,0.05,'square',0.1); },
  wallThud(){ this.noiseBurst(0.09,0.16,300); },
  reelTick(){ this.tone(320+Math.random()*70,0.035,'square',0.06); },
  dropReveal(tier){
    // fanfare scales in richness/length with rarity tier index (0=common .. 5=mythic)
    const sets = [
      [392,440],
      [392,494,587],
      [440,554,659,880],
      [349,440,554,659,880],
      [294,370,440,587,740,880],
      [261,330,392,494,587,740,880,988],
    ];
    const notes = sets[Math.min(tier, sets.length-1)];
    notes.forEach((n,i)=> setTimeout(()=> this.tone(n, 0.28+tier*0.03, tier>=4?'sawtooth':'triangle', 0.22), i*(75-tier*6)));
    if(tier>=3) setTimeout(()=> this.noiseBurst(0.3,0.22,1500), 40);
  }
};

/* ------------------------------ Item / Rarity / Inventory system ----------------------------- */
const TIER_ORDER = ['common','uncommon','rare','epic','legendary','mythic'];
const RARITY = {
  common:    { label:'Common',    color:'#9aa5b1', weight:100 },
  uncommon:  { label:'Uncommon',  color:'#5ad16b', weight:52  },
  rare:      { label:'Rare',      color:'#3d9bff', weight:24  },
  epic:      { label:'Epic',      color:'#b24dff', weight:9   },
  legendary: { label:'Legendary', color:'#ff9d2e', weight:2.4 },
  mythic:    { label:'Mythic',    color:'#ff4d8d', weight:0.5 },
};
const CAT_LABEL = { paint:'Car Paint', wheel:'Wheel Color', boost:'Boost Color', celebration:'Goal Celebration' };

const ITEMS = [
  // Car Paint
  {id:'paint_slate',   cat:'paint', name:'Slate Steel',    rarity:'common',    color:'#7c8b9c'},
  {id:'paint_forest',  cat:'paint', name:'Forest Drift',   rarity:'uncommon',  color:'#3f8f5c'},
  {id:'paint_sunset',  cat:'paint', name:'Sunset Blaze',   rarity:'rare',      color:'#ff8a3d'},
  {id:'paint_royal',   cat:'paint', name:'Royal Volt',     rarity:'epic',      color:'#7b5cff'},
  {id:'paint_aurum',   cat:'paint', name:'Golden Aurum',   rarity:'legendary', color:'#ffcf4d'},
  {id:'paint_prism',   cat:'paint', name:'Prism Shift',    rarity:'mythic',    color:'rainbow'},
  // Wheels
  {id:'wheel_steel',   cat:'wheel', name:'Steel Rim',      rarity:'common',    color:'#2b2f38'},
  {id:'wheel_copper',  cat:'wheel', name:'Copper Spin',    rarity:'uncommon',  color:'#b5651d'},
  {id:'wheel_azure',   cat:'wheel', name:'Azure Track',    rarity:'rare',      color:'#2ea3ff'},
  {id:'wheel_violet',  cat:'wheel', name:'Violet Glow',    rarity:'epic',      color:'#a13dff'},
  {id:'wheel_molten',  cat:'wheel', name:'Molten Gold',    rarity:'legendary', color:'#ffb02e'},
  {id:'wheel_chroma',  cat:'wheel', name:'Chroma Spin',    rarity:'mythic',    color:'rainbow'},
  // Boost
  {id:'boost_amber',   cat:'boost', name:'Amber Flame',    rarity:'common',    color:'#ffb347'},
  {id:'boost_cyan',    cat:'boost', name:'Cyan Flame',     rarity:'uncommon',  color:'#5fe3ff'},
  {id:'boost_magenta', cat:'boost', name:'Magenta Flame',  rarity:'rare',      color:'#ff4dd2'},
  {id:'boost_emerald', cat:'boost', name:'Emerald Flame',  rarity:'epic',      color:'#3dffa1'},
  {id:'boost_solar',   cat:'boost', name:'Solar Gold',     rarity:'legendary', color:'#ffe37a'},
  {id:'boost_prism',   cat:'boost', name:'Prismatic Flame',rarity:'mythic',    color:'rainbow'},
  // Goal Celebrations
  {id:'cel_classic', cat:'celebration', name:'Classic Burst',    rarity:'common'},
  {id:'cel_sparks',  cat:'celebration', name:'Spark Shower',     rarity:'uncommon'},
  {id:'cel_nova',    cat:'celebration', name:'Starburst Nova',   rarity:'rare'},
  {id:'cel_impact',  cat:'celebration', name:'Shockwave Impact', rarity:'epic'},
  {id:'cel_rex',     cat:'celebration', name:'Inferno Rex',      rarity:'legendary'},
  {id:'cel_vortex',  cat:'celebration', name:'Mythic Vortex',    rarity:'mythic'},
];

function rollRarity(){
  const total = TIER_ORDER.reduce((s,k)=>s+RARITY[k].weight,0);
  let r = Math.random()*total;
  for(const k of TIER_ORDER){ r -= RARITY[k].weight; if(r<=0) return k; }
  return TIER_ORDER[0];
}
function rollItem(){
  const rarity = rollRarity();
  const pool = ITEMS.filter(i=>i.rarity===rarity);
  return pool[Math.floor(Math.random()*pool.length)];
}

const SAVE_KEY = 'rocketrush_save_v1';
let inventory = { owned:[], equipped:{paint:null, wheel:null, boost:null, celebration:null} };
function loadInventory(){
  try{
    const raw = localStorage.getItem(SAVE_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      if(parsed && Array.isArray(parsed.owned) && parsed.equipped){
        inventory = { owned: parsed.owned, equipped: Object.assign({paint:null,wheel:null,boost:null,celebration:null}, parsed.equipped) };
      }
    }
  }catch(e){ /* storage unavailable -- play without persistence */ }
}
function saveInventory(){
  try{ localStorage.setItem(SAVE_KEY, JSON.stringify(inventory)); }catch(e){}
}
loadInventory();

function getEquippedColor(cat){
  const id = inventory.equipped[cat];
  if(!id) return null;
  const item = ITEMS.find(i=>i.id===id);
  if(!item) return null;
  if(item.color==='rainbow'){
    const t = (performance.now()/2200) % 1;
    return `hsl(${Math.floor(t*360)},85%,60%)`;
  }
  return item.color;
}
function hexToRgbObj(hex){
  hex = hex.replace('#','');
  if(hex.length===3) hex = hex.split('').map(c=>c+c).join('');
  const num = parseInt(hex,16);
  return { r:(num>>16)&255, g:(num>>8)&255, b:num&255 };
}
function darkenColor(c, amt){
  if(typeof c!=='string') return '#111';
  if(c.startsWith('hsl(')){
    const m = c.match(/hsl\(([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%\)/);
    if(m) return `hsl(${m[1]},${m[2]}%,${Math.max(0,(+m[3])*(1-amt))}%)`;
    return c;
  }
  if(c.startsWith('#')){
    const {r,g,b} = hexToRgbObj(c);
    return `rgb(${Math.round(r*(1-amt))},${Math.round(g*(1-amt))},${Math.round(b*(1-amt))})`;
  }
  return c;
}
function withAlpha(c, a){
  if(typeof c!=='string') return `rgba(255,255,255,${a})`;
  if(c.startsWith('hsl(')){
    const m = c.match(/hsl\(([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%\)/);
    if(m) return `hsla(${m[1]},${m[2]}%,${m[3]}%,${a})`;
    return c;
  }
  if(c.startsWith('#')){
    const {r,g,b} = hexToRgbObj(c);
    return `rgba(${r},${g},${b},${a})`;
  }
  return c;
}
function swatchCss(item){
  if(item.cat==='celebration') return `background:linear-gradient(135deg, ${RARITY[item.rarity].color}, #0a0e17)`;
  if(item.color==='rainbow') return `background:conic-gradient(red,orange,yellow,green,blue,violet,red)`;
  return `background:${item.color}`;
}

/* ------------------------------ Input ----------------------------------- */
const keys = new Set();
window.addEventListener('keydown', e=>{
  const codesToBlock = ['Space','Minus','ShiftRight','ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '];
  if(codesToBlock.includes(e.code) || codesToBlock.includes(e.key)) e.preventDefault();
  keys.add(e.code);
  Audio1.init(); Audio1.resume();
});
window.addEventListener('keyup', e=>{ keys.delete(e.code); });
function isDown(...codes){ for(const c of codes) if(keys.has(c)) return true; return false; }
window.addEventListener('keydown', e=>{
  if(e.code==='KeyC' && !e.repeat && game.mode !== 'two'){
    camera.mode = camera.mode==='ball' ? 'car' : 'ball';
    Audio1.click();
  }
});

/* ------------------------------ World geometry --------------------------- */
const WORLD = {
  w: 2600, h: 1500,
  wallT: 40,
  goalHalf: 210,      // half-height of goal mouth
  goalDepth: 90,
};
WORLD.cx = WORLD.w/2; WORLD.cy = WORLD.h/2;

function goalYMin(){ return WORLD.cy - WORLD.goalHalf; }
function goalYMax(){ return WORLD.cy + WORLD.goalHalf; }

/* Boost pads: 4 small near corners of each half, 2 large near midfield sides */
function buildBoostPads(){
  const pads = [];
  const m = 260;
  const smallSpots = [
    [m, m], [m, WORLD.h-m],
    [WORLD.w-m, m], [WORLD.w-m, WORLD.h-m],
    [WORLD.cx-380, m+40], [WORLD.cx+380, m+40],
    [WORLD.cx-380, WORLD.h-m-40], [WORLD.cx+380, WORLD.h-m-40],
  ];
  smallSpots.forEach(([x,y])=> pads.push({x,y,big:false,active:true,cd:0,r:22}));
  const bigSpots = [ [WORLD.cx, 150], [WORLD.cx, WORLD.h-150] ];
  bigSpots.forEach(([x,y])=> pads.push({x,y,big:true,active:true,cd:0,r:34}));
  return pads;
}
let boostPads = buildBoostPads();

/* -------------------------------- Particles ------------------------------ */
let particles = [];
function spawnParticle(p){ particles.push(p); if(particles.length>450) particles.splice(0,particles.length-450); }
function updateParticles(dt){
  for(let i=particles.length-1;i>=0;i--){
    const p = particles[i];
    p.life -= dt;
    if(p.life<=0){ particles.splice(i,1); continue; }
    p.x += p.vx*dt; p.y += p.vy*dt;
    if(p.grav) p.vy += 900*dt;
    p.vx *= (1 - dt*(p.drag||0.5));
    p.vy *= (1 - dt*(p.drag||0.5));
  }
}
function drawParticles(){
  for(const p of particles){
    const a = Math.max(0, p.life/p.maxLife);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size*a + p.size*0.2, 0, Math.PI*2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function burst(x,y,count,color,speed,life,size,grav){
  for(let i=0;i<count;i++){
    const ang = Math.random()*Math.PI*2;
    const sp = speed*(0.4+Math.random()*0.8);
    spawnParticle({
      x,y, vx:Math.cos(ang)*sp, vy:Math.sin(ang)*sp,
      life: life*(0.6+Math.random()*0.6), maxLife: life,
      color, size: size*(0.6+Math.random()*0.8), drag:0.6, grav:!!grav
    });
  }
}

/* -------------------------- Goal celebration FX (net explosions) -------------------------- */
// These are short (~1-1.5s) animated effects anchored to the net that was scored on.
// Which one plays depends on the scoring player's equipped "celebration" drop item.
let fxList = [];
// which team color is "you" -- always 'blue' except in online mode when matched as the guest (red)
let LOCAL_TEAM = 'blue';
function isLocalCarTeam(team){
  return (typeof game!=='undefined' && game.mode==='online') ? (team===LOCAL_TEAM) : (team==='blue');
}
function spawnFX(fx){ fxList.push(fx); }
function updateFX(dt){
  for(let i=fxList.length-1;i>=0;i--){
    const f = fxList[i];
    f.t += dt;
    if(f.t >= f.duration) fxList.splice(i,1);
  }
}
function drawRingFX(f,p){ // Shockwave Impact
  const maxR = 230;
  for(let k=0;k<3;k++){
    const rp = Math.min(1, p*1.3 - k*0.14);
    if(rp<=0) continue;
    ctx.globalAlpha = Math.max(0,1-rp)*0.85;
    ctx.strokeStyle = f.color;
    ctx.lineWidth = 6-k*1.5;
    ctx.beginPath(); ctx.arc(f.x,f.y,rp*maxR,0,Math.PI*2); ctx.stroke();
  }
  ctx.globalAlpha = Math.max(0, 1-p*2.2);
  ctx.strokeStyle='#fff'; ctx.lineWidth=2;
  ctx.beginPath();
  ctx.moveTo(f.x-28,f.y); ctx.lineTo(f.x-10,f.y); ctx.moveTo(f.x+10,f.y); ctx.lineTo(f.x+28,f.y);
  ctx.moveTo(f.x,f.y-28); ctx.lineTo(f.x,f.y-10); ctx.moveTo(f.x,f.y+10); ctx.lineTo(f.x,f.y+28);
  ctx.stroke();
  ctx.globalAlpha = 1;
}
function drawBeamsFX(f,p){ // Starburst Nova
  const n = 10, spin = p*2.4, fade = Math.max(0,1-p);
  for(let i=0;i<n;i++){
    const a = (i/n)*Math.PI*2 + spin;
    const len = 60+p*260;
    const ex=f.x+Math.cos(a)*len, ey=f.y+Math.sin(a)*len;
    const grad = ctx.createLinearGradient(f.x,f.y,ex,ey);
    grad.addColorStop(0, withAlpha(f.color, 0.9*fade));
    grad.addColorStop(1, withAlpha(f.color, 0));
    ctx.strokeStyle = grad; ctx.lineWidth = 6*fade+1;
    ctx.beginPath(); ctx.moveTo(f.x,f.y); ctx.lineTo(ex,ey); ctx.stroke();
  }
  ctx.globalAlpha = fade;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(f.x,f.y, 40*(1-p)+10, 0, Math.PI*2); ctx.fill();
  ctx.globalAlpha = 1;
}
function drawRexFX(f,p){ // Inferno Rex -- an original stylized flame-beast burst, not any specific artwork
  const grow = Math.min(1,p*3);
  const shrink = Math.max(0,1-Math.max(0,p-0.6)/0.4);
  const scale = grow*(0.7+0.3*shrink);
  const alpha = grow*shrink;
  if(alpha<=0) return;
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.scale(f.dir*scale, scale);
  ctx.globalAlpha = alpha;
  const grad = ctx.createRadialGradient(0,0,4,0,0,140);
  grad.addColorStop(0,'#fff6d0');
  grad.addColorStop(0.35, f.color);
  grad.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-90,10); ctx.lineTo(-40,-60); ctx.lineTo(0,-40); ctx.lineTo(30,-70);
  ctx.lineTo(60,-30); ctx.lineTo(110,-10); ctx.lineTo(70,20); ctx.lineTo(90,55);
  ctx.lineTo(40,35); ctx.lineTo(10,55); ctx.lineTo(-20,25); ctx.lineTo(-60,45);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
}
function drawVortexFX(f,p){ // Mythic Vortex
  const n = 26;
  const alpha = p<0.7 ? p/0.7 : Math.max(0,1-(p-0.7)/0.3);
  for(let i=0;i<n;i++){
    const a = (i/n)*Math.PI*2 + p*10;
    const r = 130*(1-Math.pow(1-Math.min(1,p*1.4),2)) * (0.4+0.6*((i%3)/3));
    const x = f.x+Math.cos(a)*r, y=f.y+Math.sin(a)*r;
    ctx.globalAlpha = alpha*0.85;
    ctx.fillStyle = i%2===0 ? f.color : '#fff';
    ctx.beginPath(); ctx.arc(x,y,4,0,Math.PI*2); ctx.fill();
  }
  if(p<0.5){
    ctx.globalAlpha = (0.5-p)*2;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    for(let b=0;b<3;b++){
      const a0 = Math.random()*Math.PI*2;
      let x=f.x, y=f.y;
      ctx.beginPath(); ctx.moveTo(x,y);
      for(let s=0;s<4;s++){ x += Math.cos(a0+Math.random())*(20+Math.random()*20); y += Math.sin(a0+Math.random())*(20+Math.random()*20); ctx.lineTo(x,y); }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
function drawFX(){
  for(const f of fxList){
    const p = Math.min(1, f.t/f.duration);
    if(f.type==='ring') drawRingFX(f,p);
    else if(f.type==='beams') drawBeamsFX(f,p);
    else if(f.type==='rex') drawRexFX(f,p);
    else if(f.type==='vortex') drawVortexFX(f,p);
  }
}
function playCelebration(id, x, y, color){
  switch(id){
    case 'cel_sparks':
      burst(x,y,50,'#ffe37a',260,1.1,4,true);
      burst(x,y,30,color,220,1.0,3,true);
      break;
    case 'cel_nova':
      spawnFX({type:'beams', x,y, t:0, duration:1.3, color});
      burst(x,y,26,'#fff',260,0.7,3,false);
      break;
    case 'cel_impact':
      spawnFX({type:'ring', x,y, t:0, duration:1.1, color});
      burst(x,y,22,color,220,0.7,3,false);
      break;
    case 'cel_rex':
      spawnFX({type:'rex', x,y, t:0, duration:1.5, color, dir: x<WORLD.cx?1:-1});
      burst(x,y,30,'#ff8a3d',240,0.8,4,true);
      break;
    case 'cel_vortex':
      spawnFX({type:'vortex', x,y, t:0, duration:1.6, color});
      burst(x,y,60,color,280,1.2,4,true);
      burst(x,y,40,'#fff',260,1.0,3,true);
      break;
    case 'cel_classic':
    default:
      burst(x,y,40,color,300,0.8,4,true);
      burst(x,y,40,'#ffcf4d',260,0.8,3,true);
      break;
  }
}

/* --------------------------------- Car ------------------------------------ */
const CAR_W = 46, CAR_H = 26;
class Car{
  constructor(team, startX, startY, startAngle, isAI, keymap){
    this.team = team; // 'blue' | 'red'
    this.isAI = isAI;
    this.difficulty = 'medium';
    this.keymap = keymap;
    this.startX=startX; this.startY=startY; this.startAngle=startAngle;
    this.reset();
  }
  reset(){
    this.x = this.startX; this.y = this.startY;
    this.angle = this.startAngle;
    this.vx = 0; this.vy = 0;
    this.angVel = 0;
    this.z = 0; this.vz = 0;
    this.grounded = true;
    this.jumpsLeft = 2;
    this.boost = 100;
    this.boosting = false;
    this.spin = 0; this.spinVel = 0;
    this.wheelSpin = 0;
    this.landedPulse = 0;
    this.aiState = {targetX:this.x, targetY:this.y, reactTimer:0, mistake:0};
  }
  get speed(){ return Math.hypot(this.vx,this.vy); }
  forwardVec(){ return {x:Math.cos(this.angle), y:Math.sin(this.angle)}; }

  localInput(){
    const k = this.keymap;
    return {
      accel: isDown(k.up),
      brake: isDown(k.down),
      left: isDown(k.left),
      right: isDown(k.right),
      jump: isDown(k.jump),
      boost: isDown(k.boost),
      reset: isDown(k.reset||'__none__'),
    };
  }

  update(dt, input, ball, otherCar){
    const MAXSPEED = 460, MAXSPEED_BOOST = 720;
    const ACCEL = 720, BRAKE = 900, REV_ACCEL = 460;
    const TURN_RATE = 2.6; // rad/s at full speed factor
    const FRICTION = 0.985;
    const GRAV = 1500;
    const JUMP_VZ = 560;

    const grounded = this.z <= 0.5;
    this.grounded = grounded;

    const speedFactor = Math.min(1, this.speed / MAXSPEED);
    const moveDirSign = (this.vx*Math.cos(this.angle) + this.vy*Math.sin(this.angle)) >= 0 ? 1 : -1;

    // steering only effective while grounded (with tiny air authority)
    const turnAuthority = grounded ? 1 : 0.28;
    let turnInput = 0;
    if(input.left) turnInput -= 1;
    if(input.right) turnInput += 1;
    const desiredAngVel = turnInput * TURN_RATE * turnAuthority * (0.35+0.65*Math.max(0.15,speedFactor)) * (moveDirSign<0?-1:1);
    // ease toward the desired turn rate instead of snapping to it -- smooths out abrupt direction changes
    const TURN_EASE = grounded ? 10 : 5;
    this.angVel += (desiredAngVel - this.angVel) * Math.min(1, TURN_EASE*dt);
    this.angle += this.angVel*dt;

    // boosting
    this.boosting = input.boost && this.boost > 0 && grounded;
    if(this.boosting){
      this.boost = Math.max(0, this.boost - 34*dt);
    } else {
      this.boost = Math.min(100, this.boost + 9*dt);
    }

    if(grounded){
      const fwd = this.forwardVec();
      const maxS = this.boosting ? MAXSPEED_BOOST : MAXSPEED;
      if(input.accel){
        const a = this.boosting ? ACCEL*1.9 : ACCEL;
        this.vx += fwd.x * a * dt;
        this.vy += fwd.y * a * dt;
      } else if(input.brake){
        // brake if moving forward, reverse if stopped/slow
        if(this.speed>40 && moveDirSign>0){
          this.vx -= fwd.x * BRAKE * dt;
          this.vy -= fwd.y * BRAKE * dt;
        } else {
          this.vx -= fwd.x * REV_ACCEL * dt;
          this.vy -= fwd.y * REV_ACCEL * dt;
        }
      }
      // friction / drag
      this.vx *= Math.pow(FRICTION, dt*60);
      this.vy *= Math.pow(FRICTION, dt*60);
      // grip: pull sideways (lateral) velocity back toward the car's heading so it
      // carves through turns instead of sliding sideways through them
      const fwdN = this.forwardVec();
      const rightN = {x:-fwdN.y, y:fwdN.x};
      const vFwd = this.vx*fwdN.x + this.vy*fwdN.y;
      const vSide = this.vx*rightN.x + this.vy*rightN.y;
      const GRIP = 7.5;
      const sideKeep = Math.exp(-GRIP*dt);
      const vSideNew = vSide*sideKeep;
      this.vx = fwdN.x*vFwd + rightN.x*vSideNew;
      this.vy = fwdN.y*vFwd + rightN.y*vSideNew;
      // clamp speed
      const sp = this.speed;
      if(sp > maxS){
        const k = maxS/sp;
        this.vx*=k; this.vy*=k;
      }
      this.wheelSpin += sp*dt*0.05;
    } else {
      // air drag much lighter
      this.vx *= Math.pow(0.997, dt*60);
      this.vy *= Math.pow(0.997, dt*60);
      this.spin += this.spinVel*dt;
    }

    // jump / double jump
    if(input.jump && !this._jumpHeldPrev){
      if(grounded && this.jumpsLeft>0){
        this.vz = JUMP_VZ; this.z = 1; this.jumpsLeft--; this.grounded=false;
        this.spinVel = (Math.random()<0.5?-1:1) * 6;
        Audio1.jump();
        burst(this.x,this.y,10,'rgba(255,255,255,0.7)',140,0.35,3,false);
      } else if(!grounded && this.jumpsLeft>0){
        // double-jump flip: dash in whichever direction is held (car-relative),
        // combining forward/back + left/right into one flip direction. A very
        // small speed boost on top of the existing velocity, not a big burst.
        this.jumpsLeft--;
        const fwd = this.forwardVec();
        const rightVec = {x:-fwd.y, y:fwd.x};
        let dx=0, dy=0;
        if(input.accel){ dx+=fwd.x; dy+=fwd.y; }
        if(input.brake){ dx-=fwd.x; dy-=fwd.y; }
        if(input.right){ dx+=rightVec.x; dy+=rightVec.y; }
        if(input.left){ dx-=rightVec.x; dy-=rightVec.y; }
        const dLen = Math.hypot(dx,dy);
        const FLIP_BOOST = 110; // "very small" speed boost
        if(dLen > 0.001){
          dx/=dLen; dy/=dLen;
          this.vx += dx*FLIP_BOOST;
          this.vy += dy*FLIP_BOOST;
          this.vz = JUMP_VZ*0.55;
          this.spinVel += (dx*rightVec.x+dy*rightVec.y > 0 ? 1 : -1) * 9;
          burst(this.x,this.y,10, this.team==='blue'?'rgba(120,200,255,.8)':'rgba(255,140,110,.8)', 170,0.3,3,false);
        } else {
          // neutral double jump, no directional flip
          this.vz = JUMP_VZ*0.9;
          this.spinVel += (Math.random()<0.5?-1:1) * 8;
        }
        Audio1.jump();
      }
    }
    this._jumpHeldPrev = input.jump;

    // gravity & z integration
    this.vz -= GRAV*dt;
    this.z += this.vz*dt;
    if(this.z <= 0){
      if(this.z < -5 || this.vz < -50){
        if(this.vz < -140){ Audio1.land(); burst(this.x,this.y,14,'rgba(200,200,200,0.5)',110,0.4,3,false); this.landedPulse=0.18; }
      }
      this.z = 0; this.vz = 0; this.jumpsLeft = 2; this.spin = 0; this.spinVel=0;
    }

    // reset key
    if(input.reset) this.reset();

    // integrate position
    this.x += this.vx*dt;
    this.y += this.vy*dt;

    // walls (skip x-walls inside goal mouth & within goal depth zone, always clamp y-walls)
    const r = 22;
    if(this.y < r){ this.y = r; this.vy = Math.abs(this.vy)*0.3; }
    if(this.y > WORLD.h - r){ this.y = WORLD.h - r; this.vy = -Math.abs(this.vy)*0.3; }
    const inGoalMouthY = this.y > goalYMin()+r && this.y < goalYMax()-r;
    if(this.x < r && !inGoalMouthY){ this.x = r; this.vx = Math.abs(this.vx)*0.3; }
    if(this.x > WORLD.w - r && !inGoalMouthY){ this.x = WORLD.w - r; this.vx = -Math.abs(this.vx)*0.3; }
    // don't allow car to actually enter the goal net depth
    if(this.x < -WORLD.goalDepth + 30) { this.x = -WORLD.goalDepth+30; this.vx = Math.abs(this.vx)*0.3; }
    if(this.x > WORLD.w+WORLD.goalDepth - 30){ this.x = WORLD.w+WORLD.goalDepth-30; this.vx = -Math.abs(this.vx)*0.3; }

    if(this.landedPulse>0) this.landedPulse -= dt;

    // boost flame particles
    if(this.boosting){
      const fwd = this.forwardVec();
      const bx = this.x - fwd.x*30, by = this.y - fwd.y*30;
      spawnParticle({
        x:bx, y:by, vx:-fwd.x*160+((Math.random()-0.5)*60), vy:-fwd.y*160+((Math.random()-0.5)*60),
        life:0.22, maxLife:0.22, color: isLocalCarTeam(this.team) ? withAlpha(getEquippedColor('boost')||'#78c8ff', 0.85) : (this.team==='blue' ? 'rgba(120,200,255,0.85)' : 'rgba(255,140,110,0.85)'),
        size: 6+Math.random()*3, drag:1.2, grav:false
      });
    }
  }
}

/* --------------------------------- Ball ------------------------------------ */
class Ball{
  constructor(){ this.reset(); }
  reset(){
    this.x = WORLD.cx; this.y = WORLD.cy; this.z = 0;
    this.vx=0; this.vy=0; this.vz=0;
    this.r = 20;
    this.spin=0;
    this.trail=[];
    this.frozen=false;
  }
  update(dt){
    if(this.frozen) return;
    const GRAV = 1200;
    this.vz -= GRAV*dt;
    this.x += this.vx*dt;
    this.y += this.vy*dt;
    this.z += this.vz*dt;

    // ground
    if(this.z <= 0){
      this.z = 0;
      if(this.vz < -40){
        this.vz = -this.vz*0.52;
        Audio1.bounce();
      } else {
        this.vz = 0;
      }
      // rolling friction
      const speed = Math.hypot(this.vx,this.vy);
      const fr = Math.max(0, speed - 90*dt) / (speed||1);
      this.vx *= fr; this.vy *= fr;
    }

    // side walls (y)
    if(this.y < this.r){ this.y=this.r; this.vy = Math.abs(this.vy)*0.78; Audio1.wallThud(); burst(this.x,this.y,4,'rgba(255,255,255,.5)',100,.2,2,false);}
    if(this.y > WORLD.h-this.r){ this.y=WORLD.h-this.r; this.vy = -Math.abs(this.vy)*0.78; Audio1.wallThud(); }

    const inGoalMouthY = this.y > goalYMin()+this.r*0.4 && this.y < goalYMax()-this.r*0.4;
    if(!inGoalMouthY){
      if(this.x < this.r){ this.x=this.r; this.vx = Math.abs(this.vx)*0.78; Audio1.wallThud(); }
      if(this.x > WORLD.w-this.r){ this.x=WORLD.w-this.r; this.vx = -Math.abs(this.vx)*0.78; Audio1.wallThud(); }
    } else {
      // back of net
      if(this.x < -WORLD.goalDepth+this.r){ this.x=-WORLD.goalDepth+this.r; this.vx=Math.abs(this.vx)*0.5; }
      if(this.x > WORLD.w+WORLD.goalDepth-this.r){ this.x=WORLD.w+WORLD.goalDepth-this.r; this.vx=-Math.abs(this.vx)*0.5; }
    }

    // ceiling (soft cap so aerials feel good but ball comes back down)
    const CEIL = 900;
    if(this.z > CEIL){ this.z = CEIL; if(this.vz>0) this.vz *= -0.4; }

    // trail
    this.trail.push({x:this.x,y:this.y,z:this.z});
    if(this.trail.length>14) this.trail.shift();
  }
}

/* ---------------------------- Collision helpers ---------------------------- */
function circleHit(ax,ay,ar,bx,by,br){
  const dx=bx-ax, dy=by-ay;
  const d = Math.hypot(dx,dy);
  return d < ar+br ? {d,dx,dy} : null;
}

function carBallCollision(car, ball){
  // approximate car as circle for simplicity + directional influence
  const carR = 27;
  const zDiff = Math.abs(ball.z - car.z - 6);
  if(zDiff > 46) return; // too far apart vertically (car mostly grounded car vs high ball)
  const hit = circleHit(car.x,car.y,carR, ball.x,ball.y,ball.r);
  if(!hit) return;
  const {d,dx,dy} = hit;
  const nx = dx/(d||1), ny = dy/(d||1);
  const overlap = (carR+ball.r) - d;
  ball.x += nx*overlap; ball.y += ny*overlap;

  const carSpeed = Math.hypot(car.vx,car.vy);
  const hitPower = 170 + carSpeed*0.95 + (car.boosting? 160:0);
  ball.vx = nx*hitPower + car.vx*0.35;
  ball.vy = ny*hitPower + car.vy*0.35;
  ball.vz += 90 + Math.min(180, carSpeed*0.35) + (car.z>10? 110:0);
  const ballSpeed = Math.hypot(ball.vx,ball.vy);
  const BALL_MAX_SPEED = 980;
  if(ballSpeed > BALL_MAX_SPEED){ const k=BALL_MAX_SPEED/ballSpeed; ball.vx*=k; ball.vy*=k; }

  const speedFactor = Math.min(1, (carSpeed + (car.boosting?260:0))/900);
  Audio1.hit(speedFactor);
  burst(ball.x,ball.y, 8+Math.round(speedFactor*10), car.team==='blue'?'rgba(120,200,255,.9)':'rgba(255,140,110,.9)', 160+speedFactor*220, 0.3, 3, false);
  car._lastHitBall = 0.12;
}

function carCarCollision(a,b){
  const r=24;
  const hit = circleHit(a.x,a.y,r,b.x,b.y,r);
  if(!hit) return;
  if(Math.abs(a.z-b.z) > 40) return;
  const {d,dx,dy} = hit;
  const nx=dx/(d||1), ny=dy/(d||1);
  const overlap = (r*2-d)/2;
  a.x -= nx*overlap; a.y -= ny*overlap;
  b.x += nx*overlap; b.y += ny*overlap;
  const rel = (b.vx-a.vx)*nx + (b.vy-a.vy)*ny;
  if(rel < 0){
    const impulse = -rel*0.9;
    a.vx -= nx*impulse; a.vy -= ny*impulse;
    b.vx += nx*impulse; b.vy += ny*impulse;
  }
}

/* -------------------------------- AI logic ---------------------------------- */
const DIFF_PARAMS = {
  easy:   { reactMin:0.35, reactMax:0.6, turnMul:0.72, predT:0.15, mistake:0.22, boostUse:0.35, aerial:0.15 },
  medium: { reactMin:0.14, reactMax:0.28,turnMul:0.92, predT:0.35, mistake:0.08, boostUse:0.6,  aerial:0.4 },
  hard:   { reactMin:0.03, reactMax:0.09,turnMul:1.05, predT:0.55, mistake:0.02, boostUse:0.85, aerial:0.65 },
};

function aiThink(car, ball, otherCar, dt){
  const p = DIFF_PARAMS[car.difficulty]||DIFF_PARAMS.medium;
  car.aiState.reactTimer -= dt;
  const ownGoalX = car.team==='blue' ? 0 : WORLD.w;
  const enemyGoalX = car.team==='blue' ? WORLD.w : 0;

  if(car.aiState.reactTimer<=0){
    car.aiState.reactTimer = p.reactMin + Math.random()*(p.reactMax-p.reactMin);
    const predT = p.predT;
    let px = ball.x + ball.vx*predT;
    let py = ball.y + ball.vy*predT;

    const distToOwnGoal = Math.abs(ball.x - ownGoalX);
    const ballHeadingToOwnGoal = (car.team==='blue') ? ball.vx < -30 : ball.vx > 30;
    const defendMode = distToOwnGoal < WORLD.w*0.42 && ballHeadingToOwnGoal;

    if(defendMode){
      // position between ball and own goal, biased toward goal line
      const goalY = WORLD.cy;
      px = ownGoalX + (car.team==='blue'? 1:-1) * 160;
      py = ball.y*0.55 + goalY*0.45;
    } else {
      // attack: aim to approach the ball from the side that pushes it toward enemy goal
      const wantSideSign = (car.team==='blue') ? -1 : 1; // want to be on far side of ball from enemy goal
      const approachOffset = 70;
      px = ball.x + wantSideSign*approachOffset*Math.sign(enemyGoalX-ball.x || 1);
      py = ball.y;
    }

    if(Math.random() < p.mistake){
      px += (Math.random()-0.5)*500;
      py += (Math.random()-0.5)*400;
    }

    car.aiState.targetX = Math.max(20, Math.min(WORLD.w-20, px));
    car.aiState.targetY = Math.max(20, Math.min(WORLD.h-20, py));
    car.aiState.defend = defendMode;
  }

  const tx = car.aiState.targetX, ty = car.aiState.targetY;
  const dx = tx - car.x, dy = ty - car.y;
  const distToTarget = Math.hypot(dx,dy);
  const desiredAngle = Math.atan2(dy,dx);
  let da = desiredAngle - car.angle;
  while(da > Math.PI) da -= Math.PI*2;
  while(da < -Math.PI) da += Math.PI*2;

  const input = {accel:false, brake:false, left:false, right:false, jump:false, boost:false, reset:false};

  if(Math.abs(da) > 0.06){
    if(da>0) input.right = true; else input.left = true;
  }
  if(Math.abs(da) < Math.PI*0.55){
    input.accel = true;
  } else {
    input.brake = true;
  }
  if(distToTarget < 60){ input.accel = Math.random()>0.4; }

  // boost usage
  const distToBall = Math.hypot(ball.x-car.x, ball.y-car.y);
  if(car.boost>25 && Math.abs(da)<0.5 && Math.random()<p.boostUse && distToTarget>140){
    input.boost = true;
  }

  // jump for aerials or to hit a ball that's above car height nearby
  if(ball.z > 40 && distToBall < 130 && Math.random()<p.aerial*dt*8){
    input.jump = true;
  }
  if(ball.z < 20 && distToBall < 55 && car.grounded && Math.random()<0.02){
    input.jump = true; // pop the ball up occasionally near it
  }

  return input;
}

/* -------------------------------- Game state --------------------------------- */
const STATE = { MENU:'menu', HOW:'how', SETTINGS:'settings', COUNTDOWN:'countdown', PLAYING:'playing', GOAL:'goal', OVERTIME:'overtime', OVER:'over' };
let game = {
  state: STATE.MENU,
  mode: 'single', // 'single' | 'two'
  difficulty: 'medium',
  soundOn: true,
  score:{blue:0, red:0},
  timeLeft: 120,
  countdown: 3,
  countdownTimer: 0,
  goalTimer: 0,
  overtime:false,
  winner:null,
  dropAvailable:false,
};

const KEYMAP_P1 = {up:'KeyW', down:'KeyS', left:'KeyA', right:'KeyD', jump:'Space', boost:'ShiftLeft', reset:'KeyR'};
const KEYMAP_P1_ALT = {up:'ArrowUp'}; // (not used, kept simple)
// Player 2 uses the arrow keys to move. Jump/Boost are placed right next to the
// arrow cluster so they work on a MacBook keyboard with no numpad: Right Shift
// (boost) sits directly left of the arrows, and Minus "-" (jump) sits directly
// above the Up arrow -- both easy to reach with the same hand.
const KEYMAP_P2 = {up:'ArrowUp', down:'ArrowDown', left:'ArrowLeft', right:'ArrowRight', jump:'Minus', boost:'ShiftRight', reset:'__none__'};

let carBlue, carRed, ball;

function startPositions(){
  return {
    blue:{x: WORLD.w*0.25, y: WORLD.cy, a:0},
    red:{x: WORLD.w*0.75, y: WORLD.cy, a:Math.PI},
  };
}

function setupMatch(mode){
  stopGaragePreviewLoop();
  if(matchChannel) cleanupOnlineMatch(); // leaving an online match to play local
  game.mode = mode;
  LOCAL_TEAM = 'blue';
  const sp = startPositions();
  carBlue = new Car('blue', sp.blue.x, sp.blue.y, sp.blue.a, false, KEYMAP_P1);
  carRed = new Car('red', sp.red.x, sp.red.y, sp.red.a, mode==='single', KEYMAP_P2);
  carRed.difficulty = game.difficulty;
  ball = new Ball();
  boostPads = buildBoostPads();
  particles = [];
  fxList = [];
  game.score.blue = 0; game.score.red = 0;
  game.timeLeft = 120;
  game.overtime = false;
  game.winner = null;
  game.dropAvailable = false;
  camera.mode = 'car';
  beginCountdown();
}

function beginCountdown(){
  game.state = STATE.COUNTDOWN;
  game.countdown = 3;
  game.countdownTimer = 1;
  Audio1.countdownBeep(false);
  resetPositions();
  updateHUDVisibility();
}

function resetPositions(){
  const sp = startPositions();
  carBlue.x=sp.blue.x; carBlue.y=sp.blue.y; carBlue.angle=sp.blue.a;
  carBlue.vx=0; carBlue.vy=0; carBlue.z=0; carBlue.vz=0; carBlue.jumpsLeft=2;
  carRed.x=sp.red.x; carRed.y=sp.red.y; carRed.angle=sp.red.a;
  carRed.vx=0; carRed.vy=0; carRed.z=0; carRed.vz=0; carRed.jumpsLeft=2;
  ball.reset();
}

/* --------------------------------- UI wiring ---------------------------------- */
const $ = sel => document.querySelector(sel);
const menuMain = $('#menuMain'), menuHow = $('#menuHow'), menuSettings=$('#menuSettings'), menuOver=$('#menuOver');
const menuGarage = $('#menuGarage'), menuDrop = $('#menuDrop');
const menuLogin = $('#menuLogin'), menuLobby = $('#menuLobby'), menuNotice = $('#menuNotice');
const topBar = $('#topBar'), boostBars = $('#boostBars');
const boostP2Wrap = $('#boostP2Wrap');

function showOnly(el){
  [menuMain,menuHow,menuSettings,menuOver,menuGarage,menuDrop,menuLogin,menuLobby,menuNotice].forEach(e=> e.classList.add('hidden'));
  if(el) el.classList.remove('hidden');
}

$('#btnPlay').addEventListener('click', ()=>{ Audio1.click(); showOnly(null); setupMatch('single'); });
$('#btn2p').addEventListener('click', ()=>{ Audio1.click(); showOnly(null); setupMatch('two'); });
$('#btnHow').addEventListener('click', ()=>{ Audio1.click(); showOnly(menuHow); });
$('#closeHow').addEventListener('click', ()=>{ Audio1.click(); showOnly(menuMain); });
$('#btnSettings').addEventListener('click', ()=>{ Audio1.click(); showOnly(menuSettings); });
$('#closeSettings').addEventListener('click', ()=>{ Audio1.click(); showOnly(menuMain); });
$('#btnRematch').addEventListener('click', ()=>{
  Audio1.click();
  showOnly(null);
  if(game.mode==='online'){ startMatchmaking(); } else { setupMatch(game.mode); }
});
$('#btnMainMenu').addEventListener('click', ()=>{ Audio1.click(); goToMenu(); });
$('#btnGarage').addEventListener('click', ()=>{ Audio1.click(); showOnly(menuGarage); renderGarage(); startGaragePreviewLoop(); });
$('#closeGarage').addEventListener('click', ()=>{ Audio1.click(); showOnly(menuMain); });
$('#btnOpenDrop').addEventListener('click', ()=>{ Audio1.click(); showOnly(menuDrop); resetDropUI(); });
$('#btnDropContinue').addEventListener('click', ()=>{
  Audio1.click();
  game.dropAvailable = false;
  $('#btnOpenDrop').classList.add('hidden');
  goToMenu();
});

document.querySelectorAll('.diffBtn[data-diff]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    Audio1.click();
    document.querySelectorAll('.diffBtn[data-diff]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    game.difficulty = btn.dataset.diff;
    if(carRed) carRed.difficulty = game.difficulty;
  });
});
document.querySelectorAll('.diffBtn[data-snd]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.diffBtn[data-snd]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    game.soundOn = btn.dataset.snd === 'on';
    Audio1.enabled = game.soundOn;
    if(game.soundOn) Audio1.click();
  });
});

/* ============================================================================
   ACCOUNTS (Supabase Auth) + ONLINE MULTIPLAYER (Supabase Realtime)
   Everything in this block is guarded by `cloudReady`, so the game plays
   exactly as before (local single/2-player, localStorage inventory) if
   supabase-config.js hasn't been filled in yet.
   ============================================================================ */
const DEV_EMAILS = ['dev@rocketrush.game', 'cburdick28@brewstermadrid.com'];
let cloudReady = false;
try{ if(typeof sb !== 'undefined' && sb){ cloudReady = true; } }catch(e){}

let authUser = null;
let localName = 'Guest';

function showNotice(title, body){
  $('#noticeTitle').textContent = title;
  $('#noticeBody').textContent = body;
  showOnly(menuNotice);
}
$('#noticeOk').addEventListener('click', ()=>{ Audio1.click(); goToMenu(); });

/* ---- Auth UI ---- */
function updateAccountChip(){
  const chipText = $('#accountChipText');
  const actionBtn = $('#btnAccountAction');
  if(!cloudReady){
    chipText.textContent = 'Offline mode';
    actionBtn.classList.add('hidden');
    return;
  }
  actionBtn.classList.remove('hidden');
  if(authUser){
    chipText.textContent = 'Signed in as ' + localName;
    actionBtn.textContent = 'Log Out';
  } else {
    chipText.textContent = 'Not signed in';
    actionBtn.textContent = 'Sign In';
  }
}
$('#btnAccountAction').addEventListener('click', ()=>{
  Audio1.click();
  if(authUser){ doLogout(); } else { showOnly(menuLogin); }
});
$('#closeLogin').addEventListener('click', ()=>{ Audio1.click(); showOnly(menuMain); });
function showLoginError(msg){ const el=$('#loginError'); el.textContent=msg; el.classList.remove('hidden'); }
function clearLoginError(){ $('#loginError').classList.add('hidden'); }

$('#btnLoginSubmit').addEventListener('click', async ()=>{
  clearLoginError();
  if(!cloudReady) return showLoginError('Supabase isn\u2019t configured yet -- fill in supabase-config.js (see README).');
  const email = $('#loginEmail').value.trim(), pass = $('#loginPass').value;
  if(!email || !pass) return showLoginError('Enter an email and password.');
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  if(error) return showLoginError(error.message);
  showOnly(menuMain);
});
$('#btnSignupSubmit').addEventListener('click', async ()=>{
  clearLoginError();
  if(!cloudReady) return showLoginError('Supabase isn\u2019t configured yet -- fill in supabase-config.js (see README).');
  const email = $('#loginEmail').value.trim(), pass = $('#loginPass').value;
  const name = $('#loginName').value.trim() || (email.split('@')[0] || 'Player');
  if(!email || !pass) return showLoginError('Enter an email and password.');
  if(pass.length < 6) return showLoginError('Password must be at least 6 characters.');
  const { data, error } = await sb.auth.signUp({ email, password: pass });
  if(error) return showLoginError(error.message);
  if(!data.session){
    showLoginError('Account created! If it doesn\u2019t sign you in automatically, disable "Confirm email" in Supabase (Authentication \u2192 Providers \u2192 Email) -- see README.');
    return;
  }
  await sb.from('profiles').upsert({ id: data.user.id, name, created_at: new Date().toISOString() });
  showOnly(menuMain);
});
$('#btnGuestPlay').addEventListener('click', ()=>{ Audio1.click(); showOnly(menuMain); });
function doLogout(){
  if(cloudReady) sb.auth.signOut();
  authUser = null; localName = 'Guest';
  updateAccountChip();
}
if(cloudReady){
  sb.auth.onAuthStateChange((event, session)=>{
    const user = session ? session.user : null;
    authUser = user;
    if(user){
      sb.from('profiles').select('*').eq('id', user.id).maybeSingle().then(({data:prof})=>{
        localName = (prof && prof.name) ? prof.name : (user.email ? user.email.split('@')[0] : 'Player');
        updateAccountChip();
      });
      loadCloudInventory(user.id, user.email);
    } else {
      updateAccountChip();
    }
  });
}
updateAccountChip();

/* ---- Cloud inventory sync (extends the localStorage inventory from the Garage/Drop system) ---- */
function loadCloudInventory(uid, email){
  if(!cloudReady) return;
  const isDev = DEV_EMAILS.includes(email);
  sb.from('inventories').select('*').eq('id', uid).maybeSingle().then(({data:cloud})=>{
    if(isDev){
      // dev/showcase account: everything unlocked and equipped with the flashiest options
      inventory.owned = ITEMS.map(i=>i.id);
      inventory.equipped = { paint:'paint_prism', wheel:'wheel_chroma', boost:'boost_prism', celebration:'cel_vortex' };
      saveInventory();
    } else if(cloud && Array.isArray(cloud.owned)){
      inventory.owned = cloud.owned;
      inventory.equipped = Object.assign({paint:null,wheel:null,boost:null,celebration:null}, cloud.equipped||{});
      try{ localStorage.setItem(SAVE_KEY, JSON.stringify(inventory)); }catch(e){}
    } else {
      saveCloudInventory(); // first cloud login -- push up whatever local drops already exist
    }
    if(typeof renderGarage==='function' && menuGarage && !menuGarage.classList.contains('hidden')) renderGarage();
  });
}
function saveCloudInventory(){
  if(!cloudReady || !authUser) return;
  sb.from('inventories').upsert({ id: authUser.id, owned: inventory.owned, equipped: inventory.equipped, updated_at: new Date().toISOString() });
}

/* ---- Online matchmaking + realtime match sync ---- */
let netRole = null;         // 'host' | 'guest' | null
let matchPairKey = null;
let lobbyChannel = null;
let lobbyPollHandle = null;
let matchChannel = null;
let matchmakingInFlight = false;
let remoteNet = null;       // latest received opponent car snapshot
let hostNet = null;         // guest only: latest host-authoritative shared state (bundled with host's car snapshot)
let onlineOppName = 'Opponent';
let lastHostPublish = 0, lastGuestPublish = 0;
let lastMirroredScoreBlue = 0, lastMirroredScoreRed = 0;
const NET_PUBLISH_MS = 120; // ~8/sec per side -- comfortably under Realtime's rate limit

$('#btnOnline').addEventListener('click', ()=>{
  Audio1.click();
  if(!cloudReady){ showOnly(menuLogin); showLoginError('Online play needs Supabase configured -- see supabase-config.js and the README.'); return; }
  if(!authUser){ showOnly(menuLogin); return; }
  startMatchmaking();
});
$('#btnCancelLobby').addEventListener('click', ()=>{ Audio1.click(); cancelMatchmaking(); goToMenu(); });

function startMatchmaking(){
  showOnly(menuLobby);
  $('#lobbyStatus').textContent = 'Searching for an opponent\u2026';
  $('#btnCancelLobby').classList.remove('hidden');
  matchmakingInFlight = false;
  const uid = authUser.id;

  lobbyChannel = sb.channel('lobby-queue', { config: { presence: { key: uid } } });

  function tryFindOpponent(){
    if(matchmakingInFlight || !lobbyChannel) return;
    const state = lobbyChannel.presenceState();
    const otherUid = Object.keys(state).find(k=> k!==uid);
    if(!otherUid) return;
    const otherMeta = (state[otherUid] && state[otherUid][0]) || {};
    matchmakingInFlight = true;
    attemptMatch(uid, otherUid, otherMeta.name || 'Opponent');
  }

  lobbyChannel.on('presence', { event: 'sync' }, tryFindOpponent);
  lobbyChannel.subscribe(async (status)=>{
    if(status === 'SUBSCRIBED'){
      await lobbyChannel.track({ name: localName });
      // presence 'sync' normally fires the moment an opponent tracks too,
      // but poll as a safety net in case that event is ever missed -- this
      // is what stops a player from getting stuck on "Searching..." forever.
      if(lobbyPollHandle) clearInterval(lobbyPollHandle);
      lobbyPollHandle = setInterval(tryFindOpponent, 2500);
    }
  });
}
function cancelMatchmaking(){
  if(lobbyPollHandle){ clearInterval(lobbyPollHandle); lobbyPollHandle = null; }
  if(lobbyChannel){ sb.removeChannel(lobbyChannel); lobbyChannel = null; }
  matchmakingInFlight = false;
}
async function attemptMatch(uid, otherUid, otherName){
  try{
    const sorted = [uid, otherUid].sort();
    const pairKey = sorted.join('_');
    const p1name = sorted[0]===uid ? localName : otherName;
    const p2name = sorted[1]===uid ? localName : otherName;

    const { error } = await sb.from('matches').insert({
      pair_key: pairKey, p1: sorted[0], p2: sorted[1], p1_name: p1name, p2_name: p2name
    });
    if(error && error.code !== '23505'){ matchmakingInFlight = false; return; } // real error -- keep searching

    const { data } = await sb.from('matches').select('*').eq('pair_key', pairKey).maybeSingle();
    if(!data){ matchmakingInFlight = false; return; }

    matchPairKey = pairKey;
    netRole = (sorted[0]===uid) ? 'host' : 'guest';
    onlineOppName = (netRole==='host') ? (data.p2_name || 'Opponent') : (data.p1_name || 'Opponent');
    cancelMatchmaking(); // stop lobby polling/presence now that we have a match
    beginOnlineMatch();
  }catch(e){
    matchmakingInFlight = false; // let the poll/next sync retry
  }
}
function applyNetSnapshotToCar(car, snap){
  car.x = snap.x; car.y = snap.y; car.angle = snap.angle; car.z = snap.z||0;
  car.vx = snap.vx||0; car.vy = snap.vy||0; car.boosting = !!snap.boosting;
  car.grounded = snap.grounded!==false; car.boost = (snap.boost!=null) ? snap.boost : 100;
}
function reconcileBallWithHost(b, snap, dt){
  // The guest now simulates the ball locally too (see the guest branch in
  // update()), so hits feel instant instead of waiting on the network.
  // This nudges that local prediction back toward the host's authoritative
  // value each time a fresh update arrives, so small drift self-corrects
  // smoothly -- but if the two views have diverged a lot (e.g. right after
  // a goal reset, or a hit that played out very differently on each side),
  // it snaps immediately instead of visibly drifting into place.
  const dx = snap.bx-b.x, dy = snap.by-b.y, dz = snap.bz-b.z;
  const err = Math.hypot(dx,dy,dz);
  if(err > 140){
    b.x = snap.bx; b.y = snap.by; b.z = snap.bz;
    b.vx = snap.bvx||0; b.vy = snap.bvy||0; b.vz = snap.bvz||0;
  } else {
    const k = Math.min(1, 3*dt);
    b.x += dx*k; b.y += dy*k; b.z += dz*k;
    b.vx += ((snap.bvx||0)-b.vx)*k;
    b.vy += ((snap.bvy||0)-b.vy)*k;
    b.vz += ((snap.bvz||0)-b.vz)*k;
  }
}
function throttledPublishHost(force){
  const now = performance.now();
  if(!force && now-lastHostPublish < NET_PUBLISH_MS) return;
  lastHostPublish = now;
  if(!matchChannel) return;
  let matchStateStr = 'playing';
  if(game.state===STATE.COUNTDOWN) matchStateStr='countdown';
  else if(game.state===STATE.GOAL) matchStateStr='goal';
  else if(game.state===STATE.OVERTIME) matchStateStr='overtime';
  else if(game.state===STATE.OVER) matchStateStr='over';
  try{
    matchChannel.send({
      type:'broadcast', event:'host_update',
      payload: {
        x:carBlue.x,y:carBlue.y,angle:carBlue.angle,z:carBlue.z,vx:carBlue.vx,vy:carBlue.vy,
        boosting:carBlue.boosting,grounded:carBlue.grounded,boost:carBlue.boost,
        bx:ball.x,by:ball.y,bz:ball.z,bvx:ball.vx,bvy:ball.vy,bvz:ball.vz,
        scoreB:game.score.blue, scoreR:game.score.red,
        matchState:matchStateStr, countdown:game.countdown, timeLeft:game.timeLeft, t:Date.now()
      }
    });
  }catch(e){}
}
function throttledPublishGuest(){
  const now = performance.now();
  if(now-lastGuestPublish < NET_PUBLISH_MS) return;
  lastGuestPublish = now;
  if(!matchChannel) return;
  try{
    matchChannel.send({
      type:'broadcast', event:'guest_update',
      payload: { x:carRed.x,y:carRed.y,angle:carRed.angle,z:carRed.z,vx:carRed.vx,vy:carRed.vy,
        boosting:carRed.boosting,grounded:carRed.grounded,boost:carRed.boost,t:Date.now() }
    });
  }catch(e){}
}
function mirrorScoreAndState(net){
  if(!net) return;
  const scoreB = net.scoreB||0, scoreR = net.scoreR||0;
  if(scoreB>lastMirroredScoreBlue || scoreR>lastMirroredScoreRed){
    const scoredTeam = scoreB>lastMirroredScoreBlue ? 'blue' : 'red';
    const netX = scoredTeam==='blue' ? WORLD.w : 0, netY = WORLD.cy;
    const teamColor = scoredTeam==='blue' ? '#2ea3ff' : '#ff4d5e';
    const celId = scoredTeam===LOCAL_TEAM ? (inventory.equipped.celebration || 'cel_classic') : 'cel_classic';
    playCelebration(celId, netX, netY, teamColor);
    Audio1.goal();
    const gm = $('#goalMsg');
    gm.textContent = (scoredTeam==='blue'?'BLUE':'RED') + ' SCORES!';
    gm.className = scoredTeam;
    gm.classList.remove('hidden');
  }
  lastMirroredScoreBlue = scoreB; lastMirroredScoreRed = scoreR;
  game.score.blue = scoreB; game.score.red = scoreR;
  if(net.timeLeft!=null) game.timeLeft = net.timeLeft;

  const prevState = game.state;
  if(net.matchState==='countdown'){
    if(prevState!==STATE.COUNTDOWN){
      const sp = startPositions();
      carRed.x=sp.red.x; carRed.y=sp.red.y; carRed.angle=sp.red.a;
      carRed.vx=0; carRed.vy=0; carRed.z=0; carRed.vz=0; carRed.jumpsLeft=2; carRed.boosting=false;
    }
    game.state = STATE.COUNTDOWN;
    const cd = net.countdown;
    const numEl = $('#countdownNum');
    numEl.classList.remove('hidden');
    if(cd>0){ numEl.textContent = cd; numEl.style.color = 'var(--accent)'; }
    else { numEl.textContent = 'GO!'; numEl.style.color = '#7CFF9E'; }
  } else {
    $('#countdownNum').classList.add('hidden');
    if(net.matchState==='goal'){
      game.state = STATE.GOAL;
    } else if(net.matchState==='over'){
      if(prevState!==STATE.OVER) finishOnlineMatch(net);
    } else {
      game.state = (net.matchState==='overtime') ? STATE.OVERTIME : STATE.PLAYING;
      $('#goalMsg').classList.add('hidden');
    }
  }
}
function finishOnlineMatch(net){
  game.state = STATE.OVER;
  const b=net.scoreB||0, r=net.scoreR||0;
  const winner = b>r ? 'BLUE' : 'RED';
  const iWon = winner===LOCAL_TEAM.toUpperCase();
  $('#overTitle').textContent = iWon ? 'MATCH OVER — YOU WIN' : 'MATCH OVER — YOU LOSE';
  $('#overSub').textContent = `Blue ${b} – ${r} Red   •   ${winner} WINS`;
  $('#btnRematch').textContent = 'Find New Match';
  game.dropAvailable = false;
  $('#btnOpenDrop').classList.add('hidden');
  cleanupOnlineMatch();
  showOnly(menuOver);
}
function cleanupOnlineMatch(){
  if(matchChannel){
    try{ matchChannel.untrack(); }catch(e){}
    sb.removeChannel(matchChannel);
    matchChannel = null;
  }
  if(netRole==='host' && matchPairKey){
    sb.from('matches').delete().eq('pair_key', matchPairKey);
  }
  matchPairKey = null; netRole = null;
  remoteNet = null; hostNet = null; LOCAL_TEAM = 'blue';
}
function handleOpponentLeft(){
  if(game.state===STATE.OVER) return;
  cleanupOnlineMatch();
  showNotice('Opponent Disconnected', 'The other player left the match.');
}
function beginOnlineMatch(){
  stopGaragePreviewLoop();
  $('#lobbyStatus').textContent = 'Connecting to opponent\u2026';
  $('#btnCancelLobby').classList.add('hidden');
  LOCAL_TEAM = (netRole==='host') ? 'blue' : 'red';

  const sp = startPositions();
  carBlue = new Car('blue', sp.blue.x, sp.blue.y, sp.blue.a, false, KEYMAP_P1);
  carRed = new Car('red', sp.red.x, sp.red.y, sp.red.a, false, KEYMAP_P1);
  ball = new Ball();
  boostPads = buildBoostPads();
  particles = []; fxList = [];
  game.score.blue = 0; game.score.red = 0;
  game.timeLeft = 120;
  game.overtime = false; game.winner = null; game.dropAvailable = false; game.mode = 'online';
  camera.mode = 'car';
  remoteNet = null; hostNet = null;
  lastMirroredScoreBlue = 0; lastMirroredScoreRed = 0;

  let matchStarted = false; // true only once BOTH players are confirmed connected

  matchChannel = sb.channel('match:'+matchPairKey, {
    config: { broadcast: { self:false, ack:false }, presence: { key: authUser.id } }
  });
  const oppEvent = (netRole==='host') ? 'guest_update' : 'host_update';
  matchChannel.on('broadcast', { event: oppEvent }, ({payload})=>{
    remoteNet = payload;
    if(netRole==='guest') hostNet = payload; // combined car+shared payload from host
  });

  // Don't start playing until BOTH players are actually present in this
  // match's channel -- starting the instant *your own* connection succeeds
  // was the bug: a slower/failed opponent connection just looked like an
  // AFK opponent, since no position updates would ever arrive.
  matchChannel.on('presence', { event: 'sync' }, ()=>{
    if(matchStarted) return;
    const state = matchChannel.presenceState();
    if(Object.keys(state).length < 2) return; // still waiting on the opponent
    matchStarted = true;
    showOnly(null);
    updateHUDVisibility();
    if(netRole==='host'){
      beginCountdown();
    } else {
      game.state = STATE.COUNTDOWN; // corrected on the first host_update
    }
  });

  // Connection "noise" while both sides are still joining is normal --
  // only treat a leave as a real disconnect once the match has actually
  // started, and only if it's the opponent (not our own presence churn).
  matchChannel.on('presence', { event:'leave' }, ({leftPresences})=>{
    if(!matchStarted) return;
    const oppGone = (leftPresences||[]).some(p=> p.uid !== authUser.id);
    if(oppGone) handleOpponentLeft();
  });

  matchChannel.subscribe(async (status)=>{
    if(status === 'SUBSCRIBED'){
      await matchChannel.track({ role: netRole, uid: authUser.id });
      // If the opponent never shows up in presence within a few seconds,
      // fail cleanly instead of leaving the player stuck indefinitely.
      setTimeout(()=>{
        if(!matchStarted){
          cleanupOnlineMatch();
          showNotice('Connection Problem', 'Couldn\u2019t connect to your opponent. Please try again.');
        }
      }, 8000);
    } else if(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED'){
      if(!matchStarted){
        cleanupOnlineMatch();
        showNotice('Connection Problem', 'Lost the connection while starting the match. Please try again.');
      }
    }
  });
}
function goToMenu(){
  game.state = STATE.MENU;
  showOnly(menuMain);
  topBar.classList.add('hidden');
  boostBars.classList.add('hidden');
  $('#countdownNum').classList.add('hidden');
  $('#goalMsg').classList.add('hidden');
  stopGaragePreviewLoop();
  if(game.mode==='online'){ cleanupOnlineMatch(); }
}

function updateHUDVisibility(){
  topBar.classList.remove('hidden');
  boostBars.classList.remove('hidden');
  boostP2Wrap.classList.toggle('hidden', !(game.mode==='two' || game.mode==='online'));
  $('#camBox').classList.toggle('hidden', game.mode==='two');
  if(game.mode==='online'){
    const oppTag = 'BOOST — ' + onlineOppName.toUpperCase();
    $('#p1Label').textContent = LOCAL_TEAM==='blue' ? 'BOOST — YOU' : oppTag;
    $('#p2Label').textContent = LOCAL_TEAM==='red' ? 'BOOST — YOU' : oppTag;
  } else {
    $('#p1Label').textContent = game.mode==='two' ? 'BOOST — P1 (BLUE)' : 'BOOST — YOU';
    $('#p2Label').textContent = 'BOOST — P2 (RED)';
  }
}

function fmtTime(t){
  t = Math.max(0,Math.ceil(t));
  const m = Math.floor(t/60), s = t%60;
  return m+':'+String(s).padStart(2,'0');
}

/* --------------------------------- Garage (customization) ------------------------------------ */
let garageCat = 'paint';
document.querySelectorAll('.garageTab').forEach(t=>{
  t.addEventListener('click', ()=>{
    Audio1.click();
    document.querySelectorAll('.garageTab').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    garageCat = t.dataset.cat;
    renderGarage();
  });
});
function itemsByCat(cat){ return ITEMS.filter(i=>i.cat===cat); }
function equipItem(cat, id){
  inventory.equipped[cat] = id;
  saveInventory();
  Audio1.click();
  renderGarage();
}
function renderGarage(){
  const grid = $('#garageGrid');
  grid.innerHTML = '';
  if(garageCat !== 'celebration'){
    const def = document.createElement('div');
    def.className = 'itemCard owned' + (!inventory.equipped[garageCat] ? ' selected':'');
    def.innerHTML = `<div class="itemSwatch" style="background:#37424f"></div><div class="itemName">Default</div><div class="itemRarity" style="color:#9aa5b1">Base</div>`;
    def.addEventListener('click', ()=> equipItem(garageCat, null));
    grid.appendChild(def);
  }
  itemsByCat(garageCat).forEach(item=>{
    const owned = inventory.owned.includes(item.id);
    const info = RARITY[item.rarity];
    const card = document.createElement('div');
    card.className = 'itemCard' + (owned?' owned':' locked') + (inventory.equipped[garageCat]===item.id?' selected':'');
    card.style.setProperty('--rc', info.color);
    if(owned){
      card.innerHTML = `<div class="itemSwatch" style="${swatchCss(item)}"></div><div class="itemName">${item.name}</div><div class="itemRarity" style="color:${info.color}">${info.label}</div>`;
      card.addEventListener('click', ()=> equipItem(garageCat, item.id));
    } else {
      card.innerHTML = `<div class="itemSwatch locked">?</div><div class="itemName">${item.name}</div><div class="itemRarity" style="color:${info.color}">${info.label}</div>`;
    }
    grid.appendChild(card);
  });
}
let garageAnimActive = false;
function startGaragePreviewLoop(){
  if(garageAnimActive) return;
  garageAnimActive = true;
  garagePreviewLoop();
}
function stopGaragePreviewLoop(){ garageAnimActive = false; }
function garagePreviewLoop(){
  if(!garageAnimActive || menuGarage.classList.contains('hidden')){ garageAnimActive=false; return; }
  drawGaragePreview();
  requestAnimationFrame(garagePreviewLoop);
}
function drawGaragePreview(){
  const cvs = $('#garagePreview');
  const pctx = cvs.getContext('2d');
  pctx.clearRect(0,0,cvs.width,cvs.height);
  pctx.save();
  pctx.translate(cvs.width/2, cvs.height/2+8);
  pctx.scale(2.3,2.3);
  const t = performance.now()/1000;
  const fakeCar = { team:'blue', angle:0, boosting: Math.sin(t*2)>-0.3, grounded:true, z:0, spin:0, x:0, y:0 };
  drawCar(fakeCar, pctx);
  pctx.restore();
}

/* --------------------------------- Drop opening ------------------------------------ */
function resetDropUI(){
  $('#dropCrateWrap').classList.remove('hidden');
  $('#reelViewport').classList.add('hidden');
  $('#dropResult').classList.add('hidden');
  $('#reelStrip').innerHTML = '';
  $('#reelStrip').style.transform = 'translateX(0px)';
  $('#dropTitle').textContent = 'You earned a drop!';
  $('#dropCrateBtn').style.pointerEvents = 'all';
}
$('#dropCrateBtn').addEventListener('click', startDropOpen);
function startDropOpen(){
  $('#dropCrateBtn').style.pointerEvents = 'none';
  const won = rollItem();
  Audio1.tone(220,0.4,'sawtooth',0.14,110);
  $('#dropCrateWrap').classList.add('hidden');
  $('#reelViewport').classList.remove('hidden');

  const REVEAL_INDEX = 40, STRIP_LEN = 46, CARD_W = 96;
  const stripItems = [];
  for(let i=0;i<STRIP_LEN;i++){
    stripItems.push(i===REVEAL_INDEX ? won : ITEMS[Math.floor(Math.random()*ITEMS.length)]);
  }
  const strip = $('#reelStrip');
  strip.innerHTML = '';
  stripItems.forEach(it=>{
    const info = RARITY[it.rarity];
    const el = document.createElement('div');
    el.className = 'reelItem';
    el.style.setProperty('--rc', info.color);
    el.innerHTML = `<div class="reelSwatch" style="${swatchCss(it)}"></div><div class="reelName">${it.name}</div>`;
    strip.appendChild(el);
  });

  const viewport = $('#reelViewport');
  const vw = viewport.clientWidth;
  const targetX = -(REVEAL_INDEX*CARD_W + CARD_W/2 - vw/2) + (Math.random()*26-13);
  animateReel(strip, targetX, won);
}
function animateReel(strip, targetX, won){
  const duration = 4600;
  const start = performance.now();
  let lastTick = -1;
  function easeOutQuint(t){ return 1-Math.pow(1-t,5); }
  function step(now){
    const t = Math.min(1, (now-start)/duration);
    const x = targetX*easeOutQuint(t);
    strip.style.transform = `translateX(${x}px)`;
    const idx = Math.round(Math.abs(x)/96);
    if(idx !== lastTick){ lastTick = idx; Audio1.reelTick(); }
    if(t<1) requestAnimationFrame(step);
    else onReelStop(won);
  }
  requestAnimationFrame(step);
}
function domConfetti(count, color){
  const stage = document.querySelector('.dropStage');
  if(!stage) return;
  for(let i=0;i<count;i++){
    const el = document.createElement('div');
    el.className = 'confettiBit';
    el.style.background = Math.random()<0.5 ? color : '#ffcf4d';
    const ang = Math.random()*Math.PI*2, dist = 80+Math.random()*170;
    el.style.setProperty('--dx', Math.cos(ang)*dist+'px');
    el.style.setProperty('--dy', Math.sin(ang)*dist+'px');
    el.style.left='50%'; el.style.top='36%';
    stage.appendChild(el);
    setTimeout(()=> el.remove(), 1200);
  }
}
function onReelStop(item){
  const info = RARITY[item.rarity];
  const tierIndex = TIER_ORDER.indexOf(item.rarity);
  const isNew = !inventory.owned.includes(item.id);
  inventory.owned.push(item.id);
  saveInventory();

  $('#reelViewport').classList.add('hidden');
  const result = $('#dropResult');
  result.className = 'dropResult rarity-'+item.rarity;
  result.classList.remove('hidden');
  result.style.setProperty('--rc', info.color);
  $('#resultGlow').style.setProperty('--rc', info.color);
  $('#resultRarity').textContent = info.label.toUpperCase();
  $('#resultRarity').style.color = info.color;
  $('#resultName').textContent = item.name;
  $('#resultCat').textContent = CAT_LABEL[item.cat] + (isNew ? '' : ' • Duplicate');

  const flash = $('#dropFlash');
  flash.style.background = info.color;
  flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
  domConfetti(10+tierIndex*12, info.color);
  if(tierIndex>=4){
    const gw = $('#gameWrap');
    gw.classList.remove('shake'); void gw.offsetWidth; gw.classList.add('shake');
  }
  Audio1.dropReveal(tierIndex);
}

/* --------------------------------- Goal handling -------------------------------- */
function checkGoal(){
  if(ball.frozen) return;
  if(ball.x < -ball.r+2 && ball.y>goalYMin() && ball.y<goalYMax() && ball.z < 260){
    scoreGoal('red');
  } else if(ball.x > WORLD.w+ball.r-2 && ball.y>goalYMin() && ball.y<goalYMax() && ball.z < 260){
    scoreGoal('blue');
  }
}
function scoreGoal(team){
  game.score[team]++;
  ball.frozen = true; ball.vx=0; ball.vy=0; ball.vz=0;
  Audio1.goal();
  // ball went into the OPPOSING net: blue scoring means the ball is in red's net (right side), and vice versa
  const netX = team==='blue' ? WORLD.w : 0;
  const netY = WORLD.cy;
  const teamColor = team==='blue' ? '#2ea3ff' : '#ff4d5e';
  const celId = isLocalCarTeam(team) ? (inventory.equipped.celebration || 'cel_classic') : 'cel_classic';
  playCelebration(celId, netX, netY, teamColor);
  const gm = $('#goalMsg');
  gm.textContent = (team==='blue'?'BLUE':'RED') + ' SCORES!';
  gm.className = team;
  gm.classList.remove('hidden');
  game.state = STATE.GOAL;
  game.goalTimer = 2.1;
}

/* --------------------------------- Main loop ------------------------------------ */
let lastT = performance.now();
function frame(now){
  let dt = (now-lastT)/1000;
  lastT = now;
  dt = Math.min(dt, 1/30); // clamp for tab-switch spikes
  update(dt);
  render();
  requestAnimationFrame(frame);
}

function update(dt){
  updateParticles(dt);
  updateFX(dt);
  boostPads.forEach(p=>{ if(!p.active){ p.cd -= dt; if(p.cd<=0) p.active = true; } });

  if(game.mode==='online'){
    if(netRole==='host'){
      throttledPublishHost();
    } else if(netRole==='guest'){
      throttledPublishGuest();
      mirrorScoreAndState(hostNet);
      if(hostNet && (hostNet.matchState==='playing' || hostNet.matchState==='overtime')){
        if(remoteNet) applyNetSnapshotToCar(carBlue, remoteNet);
        const input = carRed.localInput();
        carRed.update(dt, input, ball, carBlue);
        for(const pad of boostPads){
          if(!pad.active) continue;
          const d = Math.hypot(carRed.x-pad.x, carRed.y-pad.y);
          if(d < pad.r+24){
            carRed.boost = Math.min(100, carRed.boost + (pad.big?100:25));
            pad.active = false; pad.cd = pad.big?10:4;
            Audio1.pad(pad.big);
            burst(pad.x,pad.y,pad.big?26:14,'#ffcf4d',pad.big?260:180,0.5,pad.big?4:3,false);
          }
        }
        // Client-side prediction: the guest runs its own local ball physics
        // and collisions (against its own car AND the puppeted host car) so
        // hits feel immediate instead of waiting on the network, then
        // reconciles toward the host's authoritative ball state as updates
        // arrive. Scoring/match state stays host-only -- see the summary
        // below for why that part is kept authoritative rather than mirrored.
        ball.update(dt);
        carBallCollision(carBlue, ball);
        carBallCollision(carRed, ball);
        carCarCollision(carBlue, carRed);
        reconcileBallWithHost(ball, hostNet, dt);
      } else if(remoteNet){
        applyNetSnapshotToCar(carBlue, remoteNet);
      }
      return; // guest mirrors host's state machine -- never runs it locally
    }
  }

  if(game.state===STATE.COUNTDOWN){
    game.countdownTimer -= dt;
    const num = $('#countdownNum');
    num.classList.remove('hidden');
    if(game.countdown>0){
      num.textContent = game.countdown;
      num.style.color = 'var(--accent)';
    } else {
      num.textContent = 'GO!';
      num.style.color = '#7CFF9E';
    }
    if(game.countdownTimer<=0){
      game.countdown--;
      game.countdownTimer = 1;
      if(game.countdown>=0){ Audio1.countdownBeep(game.countdown===0); }
      if(game.countdown < -0.5){
        num.classList.add('hidden');
        game.state = game.overtime ? STATE.OVERTIME : STATE.PLAYING;
      }
    }
    return;
  }

  if(game.state===STATE.GOAL){
    game.goalTimer -= dt;
    if(game.goalTimer<=0){
      $('#goalMsg').classList.add('hidden');
      if(game.timeLeft<=0){
        endOrOvertimeCheck();
      } else {
        beginCountdown();
      }
    }
    return;
  }

  if(game.state===STATE.PLAYING || game.state===STATE.OVERTIME){
    if(game.state===STATE.PLAYING){
      game.timeLeft -= dt;
      if(game.timeLeft<=0){
        game.timeLeft = 0;
        endOrOvertimeCheck();
        return;
      }
    }

    if(game.mode==='online' && netRole==='host'){
      // opponent (red) is puppeted from the network instead of run through local physics/AI
      if(remoteNet) applyNetSnapshotToCar(carRed, remoteNet);
      const p1in = carBlue.localInput();
      carBlue.update(dt, p1in, ball, carRed);
      for(const pad of boostPads){
        if(!pad.active) continue;
        const d = Math.hypot(carBlue.x-pad.x, carBlue.y-pad.y);
        if(d < pad.r+24){
          carBlue.boost = Math.min(100, carBlue.boost + (pad.big?100:25));
          pad.active = false; pad.cd = pad.big?10:4;
          Audio1.pad(pad.big);
          burst(pad.x,pad.y,pad.big?26:14,'#ffcf4d',pad.big?260:180,0.5,pad.big?4:3,false);
        }
      }
    } else {
      // inputs
      const p1in = carBlue.localInput();
      let p2in;
      if(game.mode==='two'){
        p2in = carRed.localInput();
      } else {
        p2in = aiThink(carRed, ball, carBlue, dt);
      }

      carBlue.update(dt, p1in, ball, carRed);
      carRed.update(dt, p2in, ball, carBlue);

      // boost pad pickups
      for(const pad of boostPads){
        if(!pad.active) continue;
        for(const car of [carBlue,carRed]){
          const d = Math.hypot(car.x-pad.x, car.y-pad.y);
          if(d < pad.r+24){
            car.boost = Math.min(100, car.boost + (pad.big?100:25));
            pad.active = false;
            pad.cd = pad.big?10:4;
            Audio1.pad(pad.big);
            burst(pad.x,pad.y,pad.big?26:14,'#ffcf4d',pad.big?260:180,0.5,pad.big?4:3,false);
          }
        }
      }
    }

    ball.update(dt);
    carBallCollision(carBlue, ball);
    carBallCollision(carRed, ball);
    carCarCollision(carBlue, carRed);
    checkGoal();
  }
}

function endOrOvertimeCheck(){
  if(game.score.blue === game.score.red){
    game.overtime = true;
    beginCountdown();
  } else {
    finishMatch();
  }
}

function finishMatch(){
  game.state = STATE.OVER;
  const b=game.score.blue, r=game.score.red;
  const winner = b>r ? 'BLUE' : 'RED';
  const wonAsBlueVsHardAI = game.mode==='single' && winner==='BLUE' && game.difficulty==='hard';
  game.dropAvailable = wonAsBlueVsHardAI;
  $('#overTitle').textContent = (game.mode==='single' && winner==='RED') ? 'MATCH OVER — YOU LOSE' : (game.mode==='single' ? 'MATCH OVER — YOU WIN' : 'MATCH OVER');
  $('#overSub').textContent = `Blue ${b} – ${r} Red   •   ${winner} WINS`;
  if(game.mode==='online'){
    const iWon = winner===LOCAL_TEAM.toUpperCase();
    $('#overTitle').textContent = iWon ? 'MATCH OVER — YOU WIN' : 'MATCH OVER — YOU LOSE';
    $('#btnRematch').textContent = 'Find New Match';
    if(netRole==='host') throttledPublishHost(true);
    cleanupOnlineMatch();
  } else {
    $('#btnRematch').textContent = 'Rematch';
  }
  $('#btnOpenDrop').classList.toggle('hidden', !game.dropAvailable);
  showOnly(menuOver);
}

/* ----------------------------------- Rendering ----------------------------------- */
let camera = { x: WORLD.cx, y: WORLD.cy, zoom: 1, mode: 'car' };

function computeCameraTarget(){
  if(game.mode === 'two'){
    // 2-player is local/shared-screen: always show the entire field so both
    // players can see everything, instead of a follow-camera (which only makes
    // sense when there's a single "you" to follow).
    const zoom = Math.min(window.innerWidth/(WORLD.w+200), window.innerHeight/(WORLD.h+200));
    return { cx: WORLD.cx, cy: WORLD.cy, zoom: Math.max(0.15, zoom) };
  }
  if(camera.mode === 'ball'){
    // follow the ball, zoom in a bit tighter since it's a small target
    return { cx: ball.x, cy: ball.y, zoom: 0.95 };
  }
  // follow the local player's own car (carBlue unless you're the online guest, then carRed)
  const focus = (game.mode==='online' && LOCAL_TEAM==='red') ? carRed : carBlue;
  // zoom in slightly more when the ball is close by, out a touch when it's far,
  // so you keep some sense of relative distance without losing your own car.
  const distToBall = Math.hypot(ball.x-focus.x, ball.y-focus.y);
  let zoom = 0.98 - Math.min(0.28, distToBall/2600);
  zoom = Math.max(0.68, Math.min(0.98, zoom));
  return { cx: focus.x, cy: focus.y, zoom };
}

function render(){
  const dpr = renderDPR;
  ctx.save();
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const vw = window.innerWidth, vh = window.innerHeight;
  ctx.clearRect(0,0,vw,vh);

  if(game.state===STATE.MENU || !carBlue){
    drawMenuBackdrop(vw,vh);
    ctx.restore();
    return;
  }

  const targ = computeCameraTarget();
  camera.x += (targ.cx-camera.x)*Math.min(1,6*(1/60));
  camera.y += (targ.cy-camera.y)*Math.min(1,6*(1/60));
  camera.zoom += (targ.zoom-camera.zoom)*Math.min(1,4*(1/60));

  ctx.translate(vw/2, vh/2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  drawFieldCached();
  drawBoostPads();
  drawBallShadowAndTrail();

  // draw order by z then y for pseudo depth
  const drawables = [
    {type:'car', obj:carBlue},
    {type:'car', obj:carRed},
    {type:'ball', obj:ball},
  ].sort((a,b)=> (a.obj.y - b.obj.y));

  for(const d of drawables){
    if(d.type==='car'){
      drawCar(d.obj);
      if(d.obj.isAI) drawNameTag(d.obj, 'GOOSE');
      else if(game.mode==='online' && !isLocalCarTeam(d.obj.team)) drawNameTag(d.obj, onlineOppName.toUpperCase());
    }
    else drawBall(d.obj);
  }

  drawParticles();
  drawFX();
  drawWalls();

  ctx.restore();

  // update DOM HUD
  syncHUD();
}

function drawMenuBackdrop(vw,vh){
  ctx.save();
  ctx.translate(vw/2, vh/2);
  const t = performance.now()/1000;
  const scale = Math.min(vw,vh)/900;
  ctx.scale(scale,scale);
  ctx.rotate(0.0);
  // faint rotating field behind menu
  ctx.globalAlpha = 0.35;
  ctx.translate(Math.sin(t*0.05)*20, Math.cos(t*0.04)*10);
  ctx.scale(0.5,0.5);
  ctx.translate(-WORLD.cx, -WORLD.cy);
  drawFieldCached();
  ctx.restore();
}

function drawField(c){
  c = c || ctx;
  // grass
  const g = c.createLinearGradient(0,0,0,WORLD.h);
  g.addColorStop(0,'#123321');
  g.addColorStop(1,'#0d2718');
  c.fillStyle = g;
  c.fillRect(-40,-40,WORLD.w+80,WORLD.h+80);

  // mow stripes
  c.save();
  c.beginPath(); c.rect(0,0,WORLD.w,WORLD.h); c.clip();
  const stripeW = 130;
  for(let x=-stripeW; x<WORLD.w+stripeW; x+=stripeW*2){
    c.fillStyle='rgba(255,255,255,0.025)';
    c.fillRect(x,0,stripeW,WORLD.h);
  }
  c.restore();

  // field border line
  c.strokeStyle='rgba(255,255,255,0.55)';
  c.lineWidth=4;
  c.strokeRect(2,2,WORLD.w-4,WORLD.h-4);

  // center line & circle
  c.beginPath();
  c.moveTo(WORLD.cx,0); c.lineTo(WORLD.cx,WORLD.h);
  c.stroke();
  c.beginPath();
  c.arc(WORLD.cx,WORLD.cy,150,0,Math.PI*2);
  c.stroke();
  c.beginPath();
  c.arc(WORLD.cx,WORLD.cy,5,0,Math.PI*2);
  c.fillStyle='rgba(255,255,255,0.55)'; c.fill();

  // goal boxes
  c.strokeStyle='rgba(255,255,255,0.4)';
  c.lineWidth=3;
  const boxW=220, boxH=WORLD.goalHalf*2+120;
  c.strokeRect(0, WORLD.cy-boxH/2, boxW, boxH);
  c.strokeRect(WORLD.w-boxW, WORLD.cy-boxH/2, boxW, boxH);
  const boxW2=100, boxH2=WORLD.goalHalf*2+20;
  c.strokeRect(0, WORLD.cy-boxH2/2, boxW2, boxH2);
  c.strokeRect(WORLD.w-boxW2, WORLD.cy-boxH2/2, boxW2, boxH2);

  // team tint near goals
  const tintB = c.createLinearGradient(0,0,340,0);
  tintB.addColorStop(0,'rgba(46,163,255,0.16)'); tintB.addColorStop(1,'rgba(46,163,255,0)');
  c.fillStyle=tintB; c.fillRect(0,0,340,WORLD.h);
  const tintR = c.createLinearGradient(WORLD.w,0,WORLD.w-340,0);
  tintR.addColorStop(0,'rgba(255,77,94,0.16)'); tintR.addColorStop(1,'rgba(255,77,94,0)');
  c.fillStyle=tintR; c.fillRect(WORLD.w-340,0,340,WORLD.h);
}

function drawWalls(){
  // subtle inner shadow to suggest arena walls/ceiling, drawn in screen space would be nicer,
  // but a soft vignette in world space approximates a walled arena feel.
}

function drawGoals(c){
  c = c || ctx;
  ['blue','red'].forEach(team=>{
    const isLeft = team==='blue';
    const xEdge = isLeft ? 0 : WORLD.w;
    const dir = isLeft ? -1 : 1;
    const depth = WORLD.goalDepth;
    const yMin = goalYMin(), yMax = goalYMax();

    // net back
    c.fillStyle = isLeft ? 'rgba(46,163,255,0.10)' : 'rgba(255,77,94,0.10)';
    c.fillRect(isLeft?-depth:WORLD.w, yMin, depth, yMax-yMin);

    // net crosshatch
    c.strokeStyle='rgba(255,255,255,0.35)';
    c.lineWidth=1;
    for(let i=0;i<=depth;i+=14){
      const x = xEdge + dir*i;
      c.beginPath(); c.moveTo(x,yMin); c.lineTo(x,yMax); c.stroke();
    }
    for(let yy=yMin; yy<=yMax; yy+=14){
      c.beginPath(); c.moveTo(xEdge, yy); c.lineTo(xEdge+dir*depth, yy); c.stroke();
    }

    // posts
    c.fillStyle = isLeft ? '#2ea3ff' : '#ff4d5e';
    c.fillRect(xEdge-3, yMin-8, 6, 16);
    c.fillRect(xEdge-3, yMax-8, 6, 16);
    c.fillRect(xEdge-4, yMin-8, dir*depth+4*dir, 6);
    c.strokeStyle = isLeft?'#2ea3ff':'#ff4d5e';
    c.lineWidth=5;
    c.beginPath(); c.moveTo(xEdge,yMin); c.lineTo(xEdge,yMax); c.stroke();
  });
}

// The field and goals never change at runtime, but were being fully
// redrawn (dozens of individual strokes/fills, plus rebuilding several
// gradients) on every single frame. Pre-render them once to an offscreen
// canvas and just blit that image each frame instead -- one drawImage()
// call replaces all of that per-frame work.
const FIELD_CACHE_PAD = WORLD.goalDepth + 10;
let fieldCache = null;
function buildFieldCache(){
  fieldCache = document.createElement('canvas');
  fieldCache.width = Math.ceil(WORLD.w + FIELD_CACHE_PAD*2);
  fieldCache.height = Math.ceil(WORLD.h + 20);
  const fctx = fieldCache.getContext('2d');
  fctx.translate(FIELD_CACHE_PAD, 10);
  drawField(fctx);
  drawGoals(fctx);
}
function drawFieldCached(){
  if(!fieldCache) buildFieldCache();
  ctx.drawImage(fieldCache, -FIELD_CACHE_PAD, -10);
}

function drawBoostPads(){
  const t = performance.now()/1000;
  for(const p of boostPads){
    ctx.save();
    ctx.translate(p.x,p.y);
    const pulse = 0.85+Math.sin(t*4+p.x*0.01)*0.15;
    if(p.active){
      ctx.globalAlpha = pulse;
      ctx.fillStyle = p.big ? '#ffcf4d' : '#7cd7ff';
      ctx.beginPath();
      const n=6;
      for(let i=0;i<n;i++){
        const a = (i/n)*Math.PI*2 + t*0.6;
        const rr = p.r;
        const px = Math.cos(a)*rr, py=Math.sin(a)*rr;
        if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
      }
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha=1;
      ctx.fillStyle='rgba(10,14,23,0.85)';
      ctx.beginPath(); ctx.arc(0,0,p.r*0.45,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = p.big?'#ffcf4d':'#7cd7ff';
      ctx.font = `bold ${p.big?16:12}px sans-serif`;
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(p.big?'+100':'+25', 0, 1);
    } else {
      ctx.globalAlpha=0.25;
      ctx.strokeStyle='#556';
      ctx.beginPath(); ctx.arc(0,0,p.r*0.7,0,Math.PI*2); ctx.stroke();
    }
    ctx.restore();
  }
}

function drawBallShadowAndTrail(){
  // trail
  for(let i=0;i<ball.trail.length;i++){
    const t = ball.trail[i];
    const a = (i/ball.trail.length)*0.35;
    ctx.globalAlpha=a;
    ctx.fillStyle='#fff';
    ctx.beginPath();
    ctx.arc(t.x, t.y - t.z*0.55, ball.r*0.5, 0, Math.PI*2);
    ctx.fill();
  }
  ctx.globalAlpha=1;
  // shadow
  const s = Math.max(0.25, 1-ball.z/500);
  ctx.fillStyle='rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(ball.x, ball.y, ball.r*0.9*s, ball.r*0.4*s, 0,0,Math.PI*2);
  ctx.fill();
}

let ballGradCache = null;
function drawBall(b){
  const drawY = b.y - b.z*0.55;
  ctx.save();
  ctx.translate(b.x, drawY);
  // ball shading is always the same relative gradient (fixed radius) -- build once, reuse forever
  if(!ballGradCache){
    ballGradCache = ctx.createRadialGradient(-6,-8,3,0,0,b.r);
    ballGradCache.addColorStop(0,'#ffffff');
    ballGradCache.addColorStop(0.55,'#dfe7f0');
    ballGradCache.addColorStop(1,'#9aa8ba');
  }
  ctx.fillStyle = ballGradCache;
  ctx.beginPath(); ctx.arc(0,0,b.r,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='rgba(40,50,65,0.6)';
  ctx.lineWidth=2;
  const spinA = (b.x+b.y)*0.03;
  for(let i=0;i<3;i++){
    ctx.beginPath();
    ctx.ellipse(0,0,b.r*0.8, b.r*0.28, spinA+i*Math.PI/3, 0, Math.PI*2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawNameTag(car, label){
  const drawY = car.y - car.z*0.6 - 30;
  ctx.save();
  ctx.translate(car.x, drawY);
  ctx.font = 'bold 13px Rajdhani, sans-serif';
  ctx.textAlign = 'center';
  const tagColor = car.team==='blue' ? 'rgba(46,163,255,0.7)' : 'rgba(255,77,94,0.7)';
  const textColor = car.team==='blue' ? '#9ad4ff' : '#ff9aa5';
  const padX = 8, padY = 4;
  const w = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(10,14,23,0.72)';
  ctx.strokeStyle = tagColor;
  ctx.lineWidth = 1.5;
  roundRect(ctx, -w/2-padX, -12-padY, w+padX*2, 16+padY*2-4, 6);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = textColor;
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, -8);
  ctx.restore();
}

// Fixed-geometry gradient cache keyed by color, so a boosting car reuses the
// same gradient object every frame instead of rebuilding one each frame.
// Capped in size since the Mythic "rainbow" boost color shifts hue
// continuously and would otherwise grow this cache without bound.
const boostFlameGradCache = new Map();
function getBoostFlameGradient(c, color){
  let g = boostFlameGradCache.get(color);
  if(!g){
    g = c.createLinearGradient(0,0,-26,0);
    g.addColorStop(0, withAlpha(color,0.95));
    g.addColorStop(1, withAlpha(color,0));
    boostFlameGradCache.set(color, g);
    if(boostFlameGradCache.size>40) boostFlameGradCache.clear();
  }
  return g;
}

function carVisualColors(car){
  const teamColor = car.team==='blue' ? '#2ea3ff' : '#ff4d5e';
  const teamDark = car.team==='blue' ? '#124a73' : '#7a1f29';
  // cosmetic drops apply to whichever car is YOU -- always blue in single/2-player
  // (one shared local inventory), but in online mode "you" might be the guest (red)
  if(!isLocalCarTeam(car.team)){
    return { body:teamColor, bodyDark:teamDark, trim:teamColor, wheel:'#12161f', boost:null };
  }
  const paint = getEquippedColor('paint');
  const wheelC = getEquippedColor('wheel');
  const boostC = getEquippedColor('boost');
  return {
    body: paint || teamColor,
    bodyDark: paint ? darkenColor(paint, 0.45) : teamDark,
    trim: teamColor, // always team-colored so you can tell teams apart regardless of paint
    wheel: wheelC || '#12161f',
    boost: boostC || null,
  };
}

function drawCar(car, targetCtx){
  const c = targetCtx || ctx;
  const drawY = car.y - car.z*0.6;
  c.save();
  c.translate(car.x, drawY);
  c.rotate(car.angle);
  const liftScale = 1 - Math.min(0.12, car.z*0.00025);
  c.scale(liftScale, liftScale);
  if(!car.grounded){ c.rotate(car.spin*0.3); }

  const vc = carVisualColors(car);

  // shadow handled separately (below) -- skip here

  // exhaust / boost flame
  if(car.boosting){
    const t=performance.now()/1000;
    const flick = 0.8+Math.sin(t*40)*0.2;
    c.save();
    c.translate(-CAR_W/2-2,0);
    c.scale(flick,1); // animate the flicker via transform, not by rebuilding the gradient's geometry
    const flameColor = vc.boost || '#ffdc78';
    c.fillStyle = getBoostFlameGradient(c, flameColor);
    c.beginPath();
    c.moveTo(0,-6); c.lineTo(-26,0); c.lineTo(0,6);
    c.closePath(); c.fill();
    c.restore();
  }

  // wheels
  c.fillStyle = vc.wheel;
  const wheelOffsets = [[-14,-13],[-14,13],[13,-13],[13,13]];
  for(const [wx,wy] of wheelOffsets){
    c.save(); c.translate(wx,wy);
    c.fillRect(-5,-4,10,8);
    c.restore();
  }

  // body
  c.fillStyle = vc.bodyDark;
  roundRect(c, -CAR_W/2, -CAR_H/2+3, CAR_W, CAR_H-6, 8); c.fill();
  c.fillStyle = vc.body;
  roundRect(c, -CAR_W/2+3, -CAR_H/2, CAR_W-6, CAR_H, 9); c.fill();

  // cockpit / windshield
  c.fillStyle='rgba(15,22,34,0.85)';
  roundRect(c, 2, -CAR_H/2+4, 14, CAR_H-8, 5); c.fill();

  // headlights
  c.fillStyle='#fff8d8';
  c.beginPath(); c.arc(CAR_W/2-3,-6,2.4,0,Math.PI*2); c.fill();
  c.beginPath(); c.arc(CAR_W/2-3, 6,2.4,0,Math.PI*2); c.fill();

  // team trim stripe -- stays team-colored even with a custom paint equipped
  c.fillStyle = vc.trim;
  c.fillRect(-CAR_W/2+8, -3, 10, 6);

  c.restore();

  // ground shadow
  const s = Math.max(0.35, 1-car.z/420);
  c.save();
  c.fillStyle='rgba(0,0,0,0.35)';
  c.beginPath();
  c.ellipse(car.x, car.y, 24*s, 12*s, 0,0,Math.PI*2);
  c.fill();
  c.restore();
}

function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

// syncHUD used to rewrite every HUD element (including a full innerHTML
// rebuild on #camBox) on every single frame, regardless of whether anything
// actually changed -- forcing needless layout/reflow work 60x/sec. Now it
// only touches the DOM when a value genuinely moved.
let hudLast = { scoreB:-1, scoreR:-1, timer:'', overtime:null, boostB:-1, boostR:-1, cam:'' };
function syncHUD(){
  if(game.score.blue !== hudLast.scoreB){ $('#scoreBlue').textContent = game.score.blue; hudLast.scoreB = game.score.blue; }
  if(game.score.red !== hudLast.scoreR){ $('#scoreRed').textContent = game.score.red; hudLast.scoreR = game.score.red; }

  const timerBox = $('#timerBox');
  const timerText = game.overtime ? 'OVERTIME' : fmtTime(game.timeLeft);
  if(timerText !== hudLast.timer){ timerBox.textContent = timerText; hudLast.timer = timerText; }
  if(game.overtime !== hudLast.overtime){ timerBox.classList.toggle('overtime', !!game.overtime); hudLast.overtime = game.overtime; }

  const bB = Math.max(0, carBlue.boost);
  if(Math.abs(bB-hudLast.boostB) > 0.4){ $('#boostP1').style.width = bB+'%'; hudLast.boostB = bB; }
  const bR = Math.max(0, carRed.boost);
  if(Math.abs(bR-hudLast.boostR) > 0.4){ $('#boostP2').style.width = bR+'%'; hudLast.boostR = bR; }

  const camLabel = camera.mode==='ball' ? 'CAM: BALL' : 'CAM: CAR';
  if(camLabel !== hudLast.cam){ $('#camBoxLabel').textContent = camLabel; hudLast.cam = camLabel; }
}

/* Draw car body ground-shadow ordering fix: shadows should sit under everything.
   We already draw shadow after body in drawCar for simplicity; visually acceptable
   given small overlap, matches arcade-style presentation. */

/* kick things off */
goToMenu();
requestAnimationFrame(frame);

})();