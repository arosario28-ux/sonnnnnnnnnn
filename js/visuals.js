// Things that move: the cars, the ball, and the particle effects (boost flames, trails, goal
// explosions). Models are loaded once and cloned per car.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { BALL_R, CAR } from './physics.js';
import { TEAM_COLORS, GLOW } from './arena.js';

const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/';
export const loaders = {
  gltf: new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath(THREE_CDN + 'libs/draco/gltf/')),
  hdr: new RGBELoader(),
};

// Car bodies. `paint` and `rims` name the materials in each file that get recoloured. Every file
// shares one layout: nose toward +z, tyres on y = 0, wheel nodes wheel_fl/fr/rl/rr.
export const CAR_MODELS = {
  gtr: { paint: ['r35_paint'], rims: ['r35_wheel_05a'] },
  evo: { paint: ['material_0'], rims: ['material_18'] },
  m4: { paint: ['Material_692'], rims: ['Material_753'] },
  c8: { paint: ['Body_Color'], rims: ['material'] },
  mclaren: { paint: ['Primary_Paint'], rims: ['Wheel_1A'] },
  huracan: { paint: ['Huracan_EVO_Paint'], rims: ['Gloss_Black', 'Chrome'] },
  veyron: { paint: ['secondary'], rims: ['wheel_rf.1'] },
};
const CAR_LENGTH = 132;   // every body is scaled to this many units long
const PAINT_MATS = ['r35_paint'], RIM_MATS = ['r35_wheel_05a'];
const WHEEL_NAMES = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'];

// Used only if the car file can't be fetched, so the game still runs.
function fallbackCar() {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial(); paint.name = PAINT_MATS[0];
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.6, 4.3).translate(0, 0.62, 0), paint);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.45, 2).translate(0, 1.1, -0.3), new THREE.MeshStandardMaterial({ color: 0x0c0f14, metalness: 1, roughness: 0.1 }));
  g.add(body, cabin);
  const tire = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 20).rotateZ(Math.PI / 2);
  const rim = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.7 }); rim.name = RIM_MATS[0];
  [[0.9, 1.4], [-0.9, 1.4], [0.9, -1.4], [-0.9, -1.4]].forEach(([x, z], i) => {
    const w = new THREE.Mesh(tire, rim);
    w.name = WHEEL_NAMES[i];
    w.position.set(x, 0.36, z);
    g.add(w);
  });
  return g;
}

const carCache = new Map();
export function loadCar(id) {
  if (!carCache.has(id)) {
    carCache.set(id, loaders.gltf.loadAsync(`assets/cars/${id}.glb`).then((g) => g.scene, (e) => { console.warn(`Car "${id}" failed to load; using a stand-in.`, e); return fallbackCar(); }));
  }
  return carCache.get(id);
}

export async function loadModels() {
  const [car, ball] = await Promise.all([
    loadCar('gtr'),
    loaders.gltf.loadAsync('assets/ball/football.gltf').then((g) => g.scene, (e) => { console.warn('Ball model failed to load; using a stand-in.', e); return null; }),
  ]);
  return { car, ball };
}

// A cosmetic colour is a hex string, or 'rainbow', which cycles.
const hue = new THREE.Color();
export function lookColor(value, fallback, time, out) {
  if (value === 'rainbow') return out.setHSL((time / 2.2) % 1, 0.85, 0.55);
  return out.set(value || fallback);
}

function nameTag(text, color) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.font = '700 54px Rajdhani, "Segoe UI", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = Math.min(500, g.measureText(text).width + 56);
  g.fillStyle = 'rgba(8,12,20,0.62)';
  g.beginPath(); g.roundRect(256 - w / 2, 10, w, 76, 22); g.fill();
  g.fillStyle = color; g.fillRect(256 - w / 2 + 16, 74, w - 32, 6);
  g.fillStyle = '#fff'; g.fillText(text, 256, 46, 470);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  s.scale.set(330, 62, 1);
  s.renderOrder = 10;
  return s;
}

export class CarView {
  constructor(scene, template, team, name) {
    this.team = team;
    this.look = {};
    this.group = new THREE.Group();
    this.paint = new THREE.MeshPhysicalMaterial({ metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.3 });
    this.bodyId = 'gtr';
    this.mount(template, CAR_MODELS.gtr);

    const team3 = new THREE.Color(TEAM_COLORS[team]);
    this.glow = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 230),
      new THREE.MeshBasicMaterial({ map: GLOW.tex, color: team3.clone().multiplyScalar(1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = -CAR.REST + 3;
    this.group.add(this.glow);

    this.flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW.tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.flame.position.set(0, -6, -78);
    this.flame.visible = false;
    this.group.add(this.flame);

    this.tag = name ? nameTag(name, '#' + team3.getHexString()) : null;
    if (this.tag) scene.add(this.tag);
    this.boostColor = new THREE.Color();
    this.scene = scene;
    scene.add(this.group);
  }

  // Puts a car body on this car. Every model is scaled to the same length and sat on its tyres,
  // so they all fit the one hitbox.
  mount(template, def) {
    if (this.model) this.group.remove(this.model);
    const model = template.clone(true);
    const box = new THREE.Box3().setFromObject(model);
    const s = CAR_LENGTH / (box.max.z - box.min.z);
    model.scale.setScalar(s);
    model.position.set(0, -CAR.REST - box.min.y * s, -(box.max.z + box.min.z) / 2 * s);
    this.rims = [];
    this.wheels = [];
    const made = new Map();
    this.paint.map = null;
    model.traverse((o) => {
      if (WHEEL_NAMES.includes(o.name)) { o.rotation.order = 'YXZ'; this.wheels[WHEEL_NAMES.indexOf(o.name)] = o; }
      if (!o.isMesh) return;
      o.castShadow = true;
      const inWheel = WHEEL_NAMES.includes(o.name) || WHEEL_NAMES.includes(o.parent?.name);
      if (!inWheel && def.paint.includes(o.material.name)) { this.paint.map = o.material.map; o.material = this.paint; }
      else if (inWheel && def.rims.includes(o.material.name)) {
        if (!made.has(o.material.uuid)) { const mat = o.material.clone(); made.set(o.material.uuid, mat); this.rims.push({ mat, base: mat.color.clone() }); }
        o.material = made.get(o.material.uuid);
      }
    });
    this.paint.needsUpdate = true;
    this.model = model;
    this.group.add(model);
  }

  // look: { paint, wheel, boost } colours and { body } car model id, any of which may be missing
  setLook(look) {
    this.look = look || {};
    const id = CAR_MODELS[this.look.body] ? this.look.body : 'gtr';
    if (id === this.bodyId) return;
    this.bodyId = id;
    loadCar(id).then((tpl) => { if (this.bodyId === id && !this.gone) this.mount(tpl, CAR_MODELS[id]); });
  }

  update(car, time, showTag = true) {
    const g = this.group;
    g.visible = !car.demoed;
    if (this.tag) this.tag.visible = showTag && !car.demoed;
    if (car.demoed) return;
    g.position.copy(car.pos);
    g.quaternion.copy(car.quat);
    lookColor(this.look.paint, TEAM_COLORS[this.team], time, this.paint.color);
    for (const r of this.rims) { if (this.look.wheel) lookColor(this.look.wheel, 0, time, r.mat.color); else r.mat.color.copy(r.base); }
    lookColor(this.look.boost, this.team === 0 ? '#59c8ff' : '#ffb347', time, this.boostColor);
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      if (!w) continue;
      w.rotation.x = car.wheelSpin;
      if (i < 2) w.rotation.y = -car.steerAngle;
    }
    this.flame.visible = car.boosting;
    if (car.boosting) {
      this.flame.material.color.copy(this.boostColor).multiplyScalar(1.8);
      this.flame.scale.setScalar(60 + Math.random() * 25);
    }
    this.glow.material.opacity = car.onGround ? 0.5 : 0.15;
    if (this.tag) this.tag.position.copy(car.pos).y += 105;
  }

  dispose() {
    this.gone = true;
    this.scene.remove(this.group);
    if (this.tag) { this.scene.remove(this.tag); this.tag.material.map.dispose(); this.tag.material.dispose(); }
    this.paint.dispose();
  }
}

export class BallView {
  constructor(scene, template) {
    let mesh = null;
    template?.traverse((o) => { if (o.isMesh && /inflated/i.test(o.name + o.parent?.name) && !/deflated/i.test(o.name + o.parent?.name)) mesh = o; });
    if (mesh) {
      const geo = mesh.geometry.clone();
      geo.computeBoundingSphere();
      geo.translate(-geo.boundingSphere.center.x, -geo.boundingSphere.center.y, -geo.boundingSphere.center.z);
      geo.scale(...Array(3).fill(BALL_R / geo.boundingSphere.radius));
      const mat = mesh.material.clone();
      mat.envMapIntensity = 1.2;
      this.mesh = new THREE.Mesh(geo, mat);
    } else {
      this.mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(BALL_R, 4), new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.35, metalness: 0.1, flatShading: true }));
    }
    this.mesh.castShadow = true;
    scene.add(this.mesh);

    // where it will land: a ring on the ground under the ball
    this.ring = new THREE.Mesh(new THREE.RingGeometry(BALL_R * 0.86, BALL_R * 1.02, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 1;
    scene.add(this.ring);
  }

  update(ball) {
    this.mesh.position.copy(ball.pos);
    this.mesh.quaternion.copy(ball.quat);
    this.ring.position.set(ball.pos.x, 2, ball.pos.z);
    const h = Math.max(0, ball.pos.y - BALL_R);
    this.ring.material.opacity = Math.min(0.75, 0.15 + h / 600);
    this.ring.visible = Math.abs(ball.pos.z) < 5120;
  }
}

// ---- particles: one draw call of soft additive points
const MAX = 4000;
const VERT = `
attribute float size; attribute vec4 tint; varying vec4 vTint; uniform float scale;
void main() {
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying vec4 vTint;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  gl_FragColor = vec4(vTint.rgb * a * a * vTint.a, 1.0);
}`;

export class Particles {
  constructor(scene) {
    this.n = 0;
    this.p = new Float32Array(MAX * 3); this.v = new Float32Array(MAX * 3);
    this.tint = new Float32Array(MAX * 4); this.size = new Float32Array(MAX);
    this.rgb = new Float32Array(MAX * 3);
    this.meta = new Float32Array(MAX * 6);   // life, maxLife, size0, size1, gravity, drag
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('tint', new THREE.BufferAttribute(this.tint, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { scale: { value: 600 } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.rings = [];
    this.scene = scene;
  }

  emit(x, y, z, vx, vy, vz, life, size0, size1, r, g, b, gravity = 0, drag = 0) {
    let i = this.n;
    if (i >= MAX) i = Math.floor(Math.random() * MAX); else this.n++;
    this.p.set([x, y, z], i * 3); this.v.set([vx, vy, vz], i * 3);
    this.rgb.set([r, g, b], i * 3);
    this.meta.set([life, life, size0, size1, gravity, drag], i * 6);
  }

  // A burst in all directions.
  burst(pos, count, speed, life, size, color, gravity = 300, up = 0) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, c = Math.random() * 2 - 1, s = Math.sqrt(1 - c * c);
      const v = speed * (0.25 + Math.random() * 0.75);
      this.emit(pos.x, pos.y, pos.z, Math.cos(a) * s * v, c * v + up, Math.sin(a) * s * v, life * (0.5 + Math.random() * 0.5), size, size * 0.2, color.r, color.g, color.b, gravity, 1.2);
    }
  }

  // An expanding flat ring or sphere of light.
  shock(pos, color, radius, time, sphere = false) {
    const geo = sphere ? new THREE.SphereGeometry(1, 24, 16) : new THREE.RingGeometry(0.82, 1, 64);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    m.position.copy(pos);
    if (!sphere) { m.rotation.x = -Math.PI / 2; m.position.y = Math.max(8, Math.min(pos.y, 40)); }
    this.scene.add(m);
    this.rings.push({ m, radius, time, age: 0 });
  }

  update(dt, camera, height) {
    this.mat.uniforms.scale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const { p, v, meta, tint, size, rgb } = this;
    for (let i = 0; i < this.n; i++) {
      const m = i * 6;
      meta[m] -= dt;
      if (meta[m] <= 0) {
        // remove by moving the last one into this slot
        const l = --this.n;
        if (l !== i) {
          p.copyWithin(i * 3, l * 3, l * 3 + 3); v.copyWithin(i * 3, l * 3, l * 3 + 3);
          rgb.copyWithin(i * 3, l * 3, l * 3 + 3); meta.copyWithin(m, l * 6, l * 6 + 6);
        }
        i--;
        continue;
      }
      const k = meta[m] / meta[m + 1];
      const j = i * 3;
      const drag = Math.max(0, 1 - meta[m + 5] * dt);
      v[j] *= drag; v[j + 1] = v[j + 1] * drag - meta[m + 4] * dt; v[j + 2] *= drag;
      p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
      if (p[j + 1] < 4) { p[j + 1] = 4; v[j + 1] *= -0.4; }
      size[i] = meta[m + 3] + (meta[m + 2] - meta[m + 3]) * k;
      tint[i * 4] = rgb[j]; tint[i * 4 + 1] = rgb[j + 1]; tint[i * 4 + 2] = rgb[j + 2]; tint[i * 4 + 3] = Math.min(1, k * 2.5);
    }
    const g = this.points.geometry;
    g.setDrawRange(0, this.n);
    g.attributes.position.needsUpdate = g.attributes.tint.needsUpdate = g.attributes.size.needsUpdate = true;

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      const k = r.age / r.time;
      if (k >= 1) { this.scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); this.rings.splice(i, 1); continue; }
      r.m.scale.setScalar(r.radius * (1 - (1 - k) ** 3) + 1);
      r.m.material.opacity = (1 - k) ** 1.5;
    }
  }

  clear() {
    this.n = 0;
    for (const r of this.rings) this.scene.remove(r.m);
    this.rings.length = 0;
  }
}

const tmp = new THREE.Vector3(), tmpC = new THREE.Color();

// Boost flame and supersonic streaks behind a car.
export function carTrail(fx, car, view, dt) {
  if (car.demoed) return;
  if (car.boosting) {
    const c = view.boostColor;
    for (let i = 0; i < 3; i++) {
      tmp.copy(car.fwd).multiplyScalar(-78 - Math.random() * 20).add(car.pos).addScaledVector(car.left, (Math.random() - 0.5) * 22).addScaledVector(car.up, -6);
      const back = 300 + Math.random() * 300;
      fx.emit(tmp.x, tmp.y, tmp.z,
        car.vel.x * 0.35 - car.fwd.x * back + (Math.random() - 0.5) * 90, car.vel.y * 0.35 - car.fwd.y * back + (Math.random() - 0.5) * 90, car.vel.z * 0.35 - car.fwd.z * back + (Math.random() - 0.5) * 90,
        0.26 + Math.random() * 0.18, 36, 6, c.r * 1.25, c.g * 1.25, c.b * 1.25, -60, 2);
    }
  }
  if (car.supersonic && car.onGround) {
    for (const side of [-1, 1]) {
      tmp.copy(car.left).multiplyScalar(side * 34).add(car.pos).addScaledVector(car.fwd, -50).addScaledVector(car.up, -CAR.REST + 6);
      fx.emit(tmp.x, tmp.y, tmp.z, 0, 15, 0, 0.5, 20, 4, 1.4, 1.4, 1.6, 0, 0);
    }
  }
}

export function ballTrail(fx, ball) {
  const s = ball.vel.length();
  if (s < 1400) return;
  const k = Math.min(1, (s - 1400) / 2600);
  fx.emit(ball.pos.x + (Math.random() - 0.5) * 60, ball.pos.y + (Math.random() - 0.5) * 60, ball.pos.z + (Math.random() - 0.5) * 60,
    ball.vel.x * 0.1, ball.vel.y * 0.1, ball.vel.z * 0.1, 0.35 + k * 0.3, 70, 10, 0.6 + k * 1.2, 0.7 + k * 0.5, 1.2 - k * 0.6, 0, 1);
}

// Goal explosions. `style` is the scorer's equipped celebration.
const STYLES = {
  cel_classic: { count: 500, speed: 3200, mix: 0.25 },
  cel_sparks: { count: 900, speed: 4200, mix: 0.6, gravity: 900, size: 34, alt: 0xffe9a8 },
  cel_nova: { count: 700, speed: 5200, mix: 0.3, rings: 3, alt: 0xfff2b0 },
  cel_impact: { count: 600, speed: 3600, mix: 0.2, rings: 5, sphere: true, alt: 0xcfa8ff },
  cel_rex: { count: 1100, speed: 3400, mix: 0.7, up: 1800, gravity: 500, alt: 0xff4a12, size: 90 },
  cel_vortex: { count: 1200, speed: 4600, mix: 0.5, rings: 6, sphere: true, alt: 0xff4d8d, rainbow: true },
};
export function goalExplosion(fx, pos, team, styleId) {
  const st = STYLES[styleId] || STYLES.cel_classic;
  const base = new THREE.Color(TEAM_COLORS[team]);
  const alt = new THREE.Color(st.alt ?? 0xffffff);
  for (let i = 0; i < 4; i++) {
    const c = st.rainbow ? tmpC.setHSL(Math.random(), 0.9, 0.55) : tmpC.copy(base).lerp(alt, Math.random() < st.mix ? 1 : Math.random() * 0.3);
    c.multiplyScalar(2.4);
    fx.burst(pos, st.count / 4, st.speed * (0.4 + i * 0.2), 1.9, st.size || 62, c, st.gravity ?? 350, st.up || 0);
  }
  fx.shock(pos, base.clone().multiplyScalar(2.5), 2600, 0.55, true);
  fx.shock(pos, new THREE.Color(3, 3, 3), 900, 0.3, true);
  for (let i = 0; i < (st.rings || 1); i++) {
    setTimeout(() => fx.shock(pos, (st.rainbow ? new THREE.Color().setHSL(i / 6, 0.9, 0.55) : i % 2 ? alt.clone() : base.clone()).multiplyScalar(2.2), 4200 + i * 500, 0.9 + i * 0.1, st.sphere && i % 2 === 1), i * 110);
  }
}

export function demoExplosion(fx, pos, team) {
  const c = new THREE.Color(TEAM_COLORS[team]).lerp(new THREE.Color(0xffc060), 0.5).multiplyScalar(2.5);
  fx.burst(pos, 160, 1500, 0.9, 60, c, 500);
  fx.shock(pos, c, 600, 0.35, true);
}
