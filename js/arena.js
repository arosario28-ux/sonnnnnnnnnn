// The arena you see: pitch, curved walls, goals, boost pads and the stadium around them.
// The shapes here are generated from the same numbers the physics uses (physics.js), so what
// the ball bounces off is exactly what is drawn.
import * as THREE from 'three';
import { F, PADS } from './physics.js';

export const TEAM_COLORS = [0x1f7cff, 0xff6a1f];
export const TEAM_NAMES = ['BLUE', 'ORANGE'];
const SQ = Math.SQRT1_2;
const BASE_TOP = F.RB + 140;   // the solid lower part of the wall ends here; glass above

// ---- the eight-sided footprint
const PLANES = [];
for (let k = 0; k < 8; k++) {
  const a = k * Math.PI / 4;
  const c = k % 2 ? (F.HX + F.HZ - F.CORNER) * SQ : k % 4 === 0 ? F.HX : F.HZ;
  PLANES.push({ x: Math.round(Math.cos(a) * 1e6) / 1e6, z: Math.round(Math.sin(a) * 1e6) / 1e6, c });
}
// Corner between wall k and wall k+1, with every wall moved inward by t (outward if negative).
function ringVertex(k, t) {
  const a = PLANES[(k + 8) % 8], b = PLANES[(k + 1) % 8];
  const det = a.x * b.z - a.z * b.x;
  return [((a.c - t) * b.z - a.z * (b.c - t)) / det, (a.x * (b.c - t) - (a.c - t) * b.x) / det];
}

class Builder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; }
  vert(x, y, z, nx, ny, nz, u, v) {
    const m = Math.min(1, Math.abs(z) / F.HZ) ** 1.5, c = z < 0 ? [0.25, 0.55, 1] : [1, 0.5, 0.2];
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.uv.push(u, v);
    this.col.push(1 + (c[0] - 1) * m, 1 + (c[1] - 1) * m, 1 + (c[2] - 1) * m);
    return this.pos.length / 3 - 1;
  }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  tri(a, b, c) { this.idx.push(a, b, c); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

// Wall cross-sections: lists of { t: distance in from the wall line, y, nh/ny: normal }.
function arc(low, steps = 10) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const a = i / steps * Math.PI / 2;
    if (low) out.push({ t: F.RB * (1 - Math.sin(a)), y: F.RB * (1 - Math.cos(a)), nh: Math.sin(a), ny: Math.cos(a) });
    else out.push({ t: F.RT * (1 - Math.cos(a)), y: F.H - F.RT + F.RT * Math.sin(a), nh: Math.cos(a), ny: -Math.sin(a) });
  }
  return out;
}
const flat = (y, t = 0) => ({ t, y, nh: 1, ny: 0 });
const PROFILE_BASE = [...arc(true), flat(BASE_TOP)];
const PROFILE_GLASS = [flat(BASE_TOP), ...arc(false)];
const PROFILE_OVER_GOAL = [flat(F.GH), ...arc(false)];
const PROFILE_TRIM = [flat(BASE_TOP - 9, 1.5), flat(BASE_TOP + 9, 1.5)];

// One wall (k) swept along a cross-section. x0/x1 cut a back wall short, to leave the goal mouth.
function sweep(b, k, profile, x0 = null, x1 = null, tile = 512) {
  const p = PLANES[k];
  let v = 0;
  let prev = null;
  for (let i = 0; i < profile.length; i++) {
    const s = profile[i];
    let [ax, az] = ringVertex(k - 1, s.t), [bx, bz] = ringVertex(k, s.t);
    if (x0 !== null) { ax = x0; az = p.z * (F.HZ - s.t); }
    if (x1 !== null) { bx = x1; bz = p.z * (F.HZ - s.t); }
    if (i) v += Math.hypot(s.t - profile[i - 1].t, s.y - profile[i - 1].y) / tile;
    const len = Math.hypot(bx - ax, bz - az) / tile;
    const nx = -p.x * s.nh, nz = -p.z * s.nh;
    const cur = [b.vert(ax, s.y, az, nx, s.ny, nz, 0, v), b.vert(bx, s.y, bz, nx, s.ny, nz, len, v)];
    if (prev) b.quad(prev[0], prev[1], cur[1], cur[0]);
    prev = cur;
  }
}

function buildWalls() {
  const base = new Builder(), glass = new Builder(), trim = new Builder();
  for (let k = 0; k < 8; k++) {
    if (k % 4 !== 2) {
      sweep(base, k, PROFILE_BASE, null, null, 256);
      sweep(glass, k, PROFILE_GLASS);
      sweep(trim, k, PROFILE_TRIM);
      continue;
    }
    // a back wall: solid either side of the goal, glass above it
    const s = PLANES[k].z;             // which end
    const xl = s * F.GW, xr = -s * F.GW;   // the sweep runs from the k-1 corner (on the +x side when s > 0) to the k corner
    sweep(base, k, PROFILE_BASE, null, xl, 256); sweep(base, k, PROFILE_BASE, xr, null, 256);
    sweep(glass, k, PROFILE_GLASS, null, xl); sweep(glass, k, PROFILE_GLASS, xr, null);
    sweep(glass, k, PROFILE_OVER_GOAL, xl, xr);
    sweep(trim, k, PROFILE_TRIM, null, xl); sweep(trim, k, PROFILE_TRIM, xr, null);
    // close off the cut ends of the curve beside each post
    for (const x of [xl, xr]) {
      const nx = -Math.sign(x);
      const hub = base.vert(x, 0, s * F.HZ, nx, 0, 0, 0, 0);
      const pts = PROFILE_BASE.map((q) => base.vert(x, q.y, s * (F.HZ - q.t), nx, 0, 0, q.t / 256, q.y / 256));
      for (let i = 1; i < pts.length; i++) base.tri(hub, pts[i - 1], pts[i]);
    }
  }
  return { base: base.geometry(), glass: glass.geometry(), trim: trim.geometry() };
}

function canvasTexture(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = opts.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// The pitch: mown stripes, markings, and a wash of each team's colour toward its end.
function pitchTexture() {
  return canvasTexture(2048, 2560, (g, w, h) => {
    const u = w / (F.HX * 2);   // pixels per unit
    const stripes = 16, sh = h / stripes;
    for (let i = 0; i < stripes; i++) {
      g.fillStyle = i % 2 ? '#2c8a3a' : '#32993f';
      g.fillRect(0, i * sh, w, sh + 1);
    }
    for (let i = 0; i < 20; i++) {   // cross stripes, fainter
      if (i % 2) continue;
      g.fillStyle = 'rgba(0,40,0,0.07)';
      g.fillRect(i * w / 20, 0, w / 20, h);
    }
    for (const [y0, y1, c] of [[0, h * 0.36, '40,120,255'], [h, h * 0.64, '255,120,40']]) {
      const grad = g.createLinearGradient(0, y0, 0, y1);
      grad.addColorStop(0, `rgba(${c},0.2)`); grad.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = grad;
      g.fillRect(0, Math.min(y0, y1), w, Math.abs(y1 - y0));
    }
    const img = g.getImageData(0, 0, w, h), d = img.data;   // grain
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 22;
      d[i] += n * 0.6; d[i + 1] += n; d[i + 2] += n * 0.5;
    }
    g.putImageData(img, 0, 0);

    g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = 24 * u; g.lineCap = 'butt';
    const X = (x) => (x + F.HX) * u, Z = (z) => (z + F.HZ) * u;
    const line = (x0, z0, x1, z1) => { g.beginPath(); g.moveTo(X(x0), Z(z0)); g.lineTo(X(x1), Z(z1)); g.stroke(); };
    line(-F.HX, 0, F.HX, 0);
    g.beginPath(); g.arc(X(0), Z(0), 900 * u, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.beginPath(); g.arc(X(0), Z(0), 44 * u, 0, Math.PI * 2); g.fill();
    for (const s of [-1, 1]) {
      g.strokeRect(X(-1500), Z(s > 0 ? F.HZ - 1050 : -F.HZ), 3000 * u, 1050 * u);
      g.strokeRect(X(-2600), Z(s > 0 ? F.HZ - 2100 : -F.HZ), 5200 * u, 2100 * u);
      line(-F.GW, s * (F.HZ - 6), F.GW, s * (F.HZ - 6));
    }
  }, { clamp: true });
}

function grainTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    const img = g.createImageData(w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = 90 + Math.random() * 165; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    g.putImageData(img, 0, 0);
  }, { data: true });
}

function glassTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(150,200,255,0.07)'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(210,235,255,0.5)'; g.lineWidth = 3;
    g.strokeRect(0, 0, w, h);
    g.strokeStyle = 'rgba(210,235,255,0.14)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  });
}

function panelTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#566378'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#4a566a'; g.fillRect(6, 6, w - 12, h - 12);
    g.strokeStyle = '#8fa2bd'; g.lineWidth = 2; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#75869f';
    for (const [x, y] of [[18, 18], [w - 18, 18], [18, h - 18], [w - 18, h - 18]]) { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
  });
}

function netTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 5;
    g.beginPath();
    g.moveTo(w / 2, 0); g.lineTo(w, h / 4); g.lineTo(w, h * 3 / 4); g.lineTo(w / 2, h); g.lineTo(0, h * 3 / 4); g.lineTo(0, h / 4); g.closePath();
    g.stroke();
  });
}

function crowdTexture() {
  const shirts = ['#e8e8e8', '#d33', '#27c', '#f5c542', '#2a9d5c', '#f80', '#888', '#a4d', '#fff', '#39c', '#c22', '#1f7cff', '#ff6a1f'];
  return canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#1b1f27'; g.fillRect(0, 0, w, h);
    const rows = 16, cols = 40, rh = h / rows, cw = w / cols;
    for (let r = 0; r < rows; r++) {
      g.fillStyle = '#2a303b'; g.fillRect(0, r * rh + rh * 0.78, w, rh * 0.22);
      for (let c = 0; c < cols; c++) {
        if (Math.random() < 0.12) continue;
        const x = c * cw + cw / 2 + (Math.random() - 0.5) * 3, y = r * rh + rh * 0.5;
        g.fillStyle = shirts[Math.floor(Math.random() * shirts.length)];
        g.fillRect(x - cw * 0.34, y - rh * 0.1, cw * 0.68, rh * 0.42);
        g.fillStyle = ['#e9c4a0', '#c98f63', '#8d5a3b', '#f1d3b8'][Math.floor(Math.random() * 4)];
        g.beginPath(); g.arc(x, y - rh * 0.22, cw * 0.22, 0, 7); g.fill();
      }
    }
  });
}

function glowTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.12)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  }, { clamp: true });
}
export const GLOW = { get tex() { return this._t || (this._t = glowTexture()); } };

function octagonShape(inset) {
  const s = new THREE.Shape();
  for (let k = 0; k < 8; k++) { const [x, z] = ringVertex(k, inset); k ? s.lineTo(x, -z) : s.moveTo(x, -z); }
  s.closePath();
  return s;
}

function buildGoal(team) {
  const g = new THREE.Group();
  const s = team === 0 ? -1 : 1;   // blue's goal is at -z
  const color = new THREE.Color(TEAM_COLORS[team]);
  const glow = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.6), toneMapped: false });
  const tube = (len) => new THREE.CylinderGeometry(15, 15, len, 12);
  for (const x of [-F.GW, F.GW]) {
    const post = new THREE.Mesh(tube(F.GH), glow);
    post.position.set(x, F.GH / 2, s * F.HZ);
    g.add(post);
  }
  const bar = new THREE.Mesh(tube(F.GW * 2 + 30), glow);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, F.GH, s * F.HZ);
  g.add(bar);

  const net = netTexture();
  const netMat = (rx, ry) => {
    const t = net.clone(); t.needsUpdate = true; t.repeat.set(rx / 110, ry / 110);
    return new THREE.MeshBasicMaterial({ map: t, color: color.clone().lerp(new THREE.Color(0xffffff), 0.45), transparent: true, side: THREE.DoubleSide, depthWrite: false });
  };
  const back = new THREE.Mesh(new THREE.PlaneGeometry(F.GW * 2, F.GH), netMat(F.GW * 2, F.GH));
  back.position.set(0, F.GH / 2, s * (F.HZ + F.GD));
  g.add(back);
  for (const x of [-F.GW, F.GW]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(F.GD, F.GH), netMat(F.GD, F.GH));
    side.rotation.y = Math.PI / 2;
    side.position.set(x, F.GH / 2, s * (F.HZ + F.GD / 2));
    g.add(side);
  }
  const top = new THREE.Mesh(new THREE.PlaneGeometry(F.GW * 2, F.GD), netMat(F.GW * 2, F.GD));
  top.rotation.x = Math.PI / 2;
  top.position.set(0, F.GH, s * (F.HZ + F.GD / 2));
  g.add(top);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(F.GW * 2, F.GD),
    new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.55), roughness: 0.5, metalness: 0.2, emissive: color, emissiveIntensity: 0.25 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.5, s * (F.HZ + F.GD / 2));
  floor.receiveShadow = true;
  g.add(floor);
  return g;
}

// Tiers of seating around the outside, with a roof. Purely scenery.
function buildStadium(group) {
  const seats = new Builder(), shell = new Builder();
  const tier = (b, o0, y0, o1, y1, tile) => {
    for (let k = 0; k < 8; k++) {
      const p = PLANES[k];
      const [ax, az] = ringVertex(k - 1, -o0), [bx, bz] = ringVertex(k, -o0);
      const [cx, cz] = ringVertex(k, -o1), [dx, dz] = ringVertex(k - 1, -o1);
      const run = Math.hypot(o1 - o0, y1 - y0);
      const nh = (y1 - y0) / run, ny = (o1 - o0) / run;
      const n = [-p.x * nh, Math.abs(ny) < 1e-6 ? 0 : ny, -p.z * nh];
      const l0 = Math.hypot(bx - ax, bz - az) / tile, l1 = Math.hypot(cx - dx, cz - dz) / tile;
      b.quad(
        b.vert(ax, y0, az, ...n, -l0 / 2, 0), b.vert(bx, y0, bz, ...n, l0 / 2, 0),
        b.vert(cx, y1, cz, ...n, l1 / 2, run / tile), b.vert(dx, y1, dz, ...n, -l1 / 2, run / tile),
      );
    }
  };
  tier(shell, 420, 0, 420, 260, 800);            // wall in front of the first row
  tier(seats, 420, 260, 2100, 1250, 1700);        // lower tier
  tier(shell, 2100, 1250, 2100, 1560, 800);
  tier(seats, 2100, 1560, 3900, 2900, 1700);      // upper tier
  tier(shell, 3900, 2900, 3900, 3600, 800);
  tier(shell, 4300, 4000, 2300, 4350, 800);      // roof

  const seatMat = new THREE.MeshStandardMaterial({ map: crowdTexture(), roughness: 0.9, side: THREE.DoubleSide });
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x2b3340, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide });
  const fix = (b) => { const g = b.geometry(); g.deleteAttribute('color'); return g; };
  group.add(new THREE.Mesh(fix(seats), seatMat), new THREE.Mesh(fix(shell), shellMat));

  // a band of light under the roof edge
  const band = new Builder();
  tier(band, 2300, 4290, 2300, 4350, 800);
  group.add(new THREE.Mesh(fix(band), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.4), toneMapped: false, side: THREE.DoubleSide })));

  const ground = new THREE.Mesh(new THREE.CircleGeometry(60000, 48), new THREE.MeshStandardMaterial({ color: 0x20252d, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -4;
  group.add(ground);
}

// Boost pads. Small ones are a glowing hexagon set in the floor; the six big ones carry a
// floating orb in a column of light, which shrinks away when taken and grows back as it recharges.
const PAD_COLOR = [2.3, 1.25, 0.18];
function buildPads(group) {
  const pads = [];
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x1c2029, metalness: 0.85, roughness: 0.28 });
  const smallBase = new THREE.CylinderGeometry(60, 68, 5, 6), smallCore = new THREE.CylinderGeometry(42, 42, 3, 6);
  const bigBase = new THREE.CylinderGeometry(128, 152, 16, 32), bigRing = new THREE.TorusGeometry(104, 7, 10, 48);
  const orbGeo = new THREE.SphereGeometry(48, 28, 18), hoopGeo = new THREE.TorusGeometry(76, 3.5, 8, 44);
  const beamGeo = new THREE.CylinderGeometry(40, 72, 340, 24, 1, true), poolGeo = new THREE.PlaneGeometry(1, 1);
  const glowMat = (opacity) => new THREE.MeshBasicMaterial({ map: GLOW.tex, color: 0xff9a1f, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  for (const [x, z, big] of PADS) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const lit = new THREE.MeshBasicMaterial({ color: new THREE.Color(...PAD_COLOR), toneMapped: false });
    const pool = new THREE.Mesh(poolGeo, glowMat(0.7));        // light spilling on the floor
    pool.rotation.x = -Math.PI / 2; pool.position.y = 6; pool.scale.setScalar(big ? 620 : 260); pool.renderOrder = 1;
    const p = { big, lit, pool, k: 1 };
    if (big) {
      const base = new THREE.Mesh(bigBase, baseMat); base.position.y = 8; base.receiveShadow = true;
      const ring = new THREE.Mesh(bigRing, lit); ring.rotation.x = Math.PI / 2; ring.position.y = 17;
      p.orbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(...PAD_COLOR), toneMapped: false });
      p.orb = new THREE.Mesh(orbGeo, p.orbMat);
      p.hoops = [new THREE.Mesh(hoopGeo, p.orbMat), new THREE.Mesh(hoopGeo, p.orbMat)];
      p.beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xff8a1a, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      p.beam.position.y = 186;
      p.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW.tex, color: 0xffa020, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 }));
      p.halo.scale.setScalar(260);
      p.float = new THREE.Group();
      p.float.add(p.orb, ...p.hoops, p.halo);
      g.add(base, ring, p.beam, p.float, pool);
    } else {
      const base = new THREE.Mesh(smallBase, baseMat); base.position.y = 2.5; base.receiveShadow = true;
      const core = new THREE.Mesh(smallCore, lit); core.position.y = 5.5;
      g.add(base, core, pool);
    }
    pads.push(p);
    group.add(g);
  }
  return pads;
}

function updatePads(pads, timers, t, dt) {
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i], left = timers ? timers[i] : 0, on = left <= 0;
    p.k += ((on ? 1 : 0) - p.k) * Math.min(1, dt * 9);
    const pulse = 1 + Math.sin(t * 4 + i * 1.7) * 0.12;
    const glow = (0.05 + 0.95 * p.k) * pulse;
    p.lit.color.setRGB(PAD_COLOR[0] * glow, PAD_COLOR[1] * glow, PAD_COLOR[2] * glow);
    p.pool.material.opacity = 0.7 * p.k * pulse;
    if (!p.big) continue;
    // while recharging, a dim orb grows back so you can see how long is left
    const charge = on ? 1 : 1 - left / 10;
    const dim = 0.1 + 0.9 * p.k;
    p.orbMat.color.setRGB(PAD_COLOR[0] * dim, PAD_COLOR[1] * dim, PAD_COLOR[2] * dim);
    p.float.position.y = 104 + Math.sin(t * 2.2 + i) * 9;
    p.float.scale.setScalar(on ? 0.3 + 0.7 * p.k : 0.15 + 0.5 * charge);
    p.hoops[0].rotation.set(t * 1.6, t * 0.9, 0);
    p.hoops[1].rotation.set(Math.PI / 2 + t * 1.1, 0, t * 1.9);
    p.halo.material.opacity = 0.5 * p.k;
    p.beam.material.opacity = 0.13 * p.k * pulse;
  }
}

export function buildArena(scene, loaders) {
  const group = new THREE.Group();
  scene.add(group);

  // pitch
  const pitchMat = new THREE.MeshStandardMaterial({ map: pitchTexture(), roughness: 0.95, metalness: 0 });
  const pitchGeo = new THREE.ShapeGeometry(octagonShape(0));
  const uv = pitchGeo.attributes.uv, pp = pitchGeo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pp.getX(i) / (F.HX * 2) + 0.5, pp.getY(i) / (F.HZ * 2) + 0.5);
  pitchGeo.rotateX(-Math.PI / 2);
  const pitch = new THREE.Mesh(pitchGeo, pitchMat);
  pitch.receiveShadow = true;
  group.add(pitch);

  // walls
  const w = buildWalls();
  const panel = panelTexture();
  const base = new THREE.Mesh(w.base, new THREE.MeshStandardMaterial({ map: panel, vertexColors: true, roughness: 0.38, metalness: 0.55, side: THREE.DoubleSide }));
  base.receiveShadow = true;
  const glass = new THREE.Mesh(w.glass, new THREE.MeshBasicMaterial({ map: glassTexture(), vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  glass.renderOrder = 2;
  const trimMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide });
  trimMat.color.setScalar(2.4);
  group.add(base, glass, new THREE.Mesh(w.trim, trimMat));

  const roofGeo = new THREE.ShapeGeometry(octagonShape(F.RT));
  const ru = roofGeo.attributes.uv, rp = roofGeo.attributes.position;
  for (let i = 0; i < ru.count; i++) ru.setXY(i, rp.getX(i) / 512, rp.getY(i) / 512);
  roofGeo.rotateX(-Math.PI / 2);
  const roof = new THREE.Mesh(roofGeo, new THREE.MeshBasicMaterial({ map: glassTexture(), transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
  roof.position.y = F.H;
  roof.renderOrder = 2;
  group.add(roof);

  group.add(buildGoal(0), buildGoal(1));
  buildStadium(group);
  const pads = buildPads(group);

  // floodlight towers at the corners (Kenney Racing Kit, CC0)
  const towers = [];
  for (let k = 1; k < 8; k += 2) {
    const [x1, z1] = ringVertex(k - 1, -4500), [x2, z2] = ringVertex(k, -4500);
    towers.push([(x1 + x2) / 2, (z1 + z2) / 2]);
  }
  for (const [x, z] of towers) {
    const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW.tex, color: 0xfff4dd, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 }));
    flare.scale.setScalar(2600);
    flare.position.set(x * 0.985, 5450, z * 0.985);
    group.add(flare);
  }
  loaders.gltf.load('assets/stadium/lightPostLarge.glb', (gltf) => {
    const src = gltf.scene;
    const box = new THREE.Box3().setFromObject(src);
    const scale = 5600 / (box.max.y - box.min.y);
    for (const [x, z] of towers) {
      const t = src.clone();
      t.scale.setScalar(scale);
      t.position.set(x, -box.min.y * scale, z);
      t.rotation.y = Math.atan2(-x, -z);
      group.add(t);
    }
  }, undefined, () => {});

  let t = 0;
  return {
    group,
    // `timers` are the seconds until each pad is back (0 = ready)
    update(dt, timers) {
      t += dt;
      updatePads(pads, timers, t, dt);
    },
  };
}
