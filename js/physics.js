// Physics for car soccer, tuned to the published Rocket League numbers.
//
// Everything is in Unreal units (1 uu = 1 cm), y up. The field runs along z: blue defends the
// goal at -z and attacks +z. x is the width. A car's local axes are +z nose, +y roof, +x left.
// The simulation runs at a fixed 120 Hz, like the real game.
import { Vector3, Quaternion } from 'three';

export const TICK = 1 / 120;

export const F = {
  HX: 4096, HZ: 5120, H: 2044,       // half width, half length, ceiling height
  CORNER: 1152,                      // the 45 degree corner walls cut this far in
  RB: 256, RT: 384,                  // radius of the curve where walls meet floor / ceiling
  GW: 892.755, GH: 642.775, GD: 880, // goal half width, height, depth
};
const CORNER_SUM = F.HX + F.HZ - F.CORNER;

export const BALL_R = 92.75;
const GRAVITY = 650;
const BALL_MAX = 6000, BALL_DRAG = 0.03, BALL_BOUNCE = 0.6, BALL_FRICTION = 0.285, BALL_ROLL_DECEL = 45;
const BALL_MASS = 30, CAR_MASS = 180;

export const CAR = {
  HX: 38, HY: 16, HZ: 67,            // hitbox half extents
  REST: 30,                          // hitbox centre above the surface when on its wheels
  MAX_SPEED: 2300, SUPERSONIC: 2200,
  BOOST_ACCEL: 991.667, BOOST_USE: 33.3, BOOST_START: 33.3,
  BRAKE: 3500, COAST: 525, STICKY: 325,
  JUMP: 292, JUMP_HOLD_ACCEL: 1458, JUMP_HOLD_TIME: 0.2, FLIP_WINDOW: 1.25,
  DODGE: 500, DODGE_TIME: 0.65, DODGE_SPIN: 7.6,
  AIR_THROTTLE: 66.667, MAX_SPIN: 5.5,
};
const WHEELS = [[34, -CAR.REST, 46], [-34, -CAR.REST, 46], [34, -CAR.REST, -46], [-34, -CAR.REST, -46]];
const CORNERS = [];
for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) CORNERS.push([x * CAR.HX, y * CAR.HY, z * CAR.HZ]);
const INV_INERTIA = new Vector3(
  12 / ((2 * CAR.HY) ** 2 + (2 * CAR.HZ) ** 2),
  12 / ((2 * CAR.HX) ** 2 + (2 * CAR.HZ) ** 2),
  12 / ((2 * CAR.HX) ** 2 + (2 * CAR.HY) ** 2),
).multiplyScalar(0.45);   // a little heavier to turn than a plain box, so landings don't tumble

// Boost pads: [x, z, big]
export const PADS = [];
for (const [x, z] of [[3584, 0], [3072, 4096]]) for (const sx of [-1, 1]) for (const sz of z ? [-1, 1] : [1]) PADS.push([sx * x, sz * z, true]);
for (const [x, z] of [[0, 4240], [1792, 4184], [940, 3308], [0, 2816], [3584, 2484], [1788, 2300], [2048, 1036], [0, 1024], [1024, 0]]) {
  for (const sx of x ? [-1, 1] : [1]) for (const sz of z ? [-1, 1] : [1]) PADS.push([sx * x, sz * z, false]);
}
export const PAD_BIG_TIME = 10, PAD_SMALL_TIME = 4;

// Kickoff spots for blue: [x, z, yaw]. Red uses the same spots turned half way round.
export const KICKOFFS = [
  [-2048, -2560, Math.atan2(2048, 2560)], [2048, -2560, -Math.atan2(2048, 2560)],   // the diagonals face the ball
  [-256, -3840, 0], [256, -3840, 0], [0, -4608, 0],
];

const SQ = Math.SQRT1_2;

// Distance from point p to the nearest arena surface (negative when p is inside a wall), writing
// the surface normal, which points into the arena, to n.
export function arenaDist(p, n) {
  const ax = Math.abs(p.x), az = Math.abs(p.z), y = p.y;
  const sx = p.x < 0 ? -1 : 1, sz = p.z < 0 ? -1 : 1;

  if (ax <= F.GW && y <= F.GH && az > F.HZ - 400) {
    // In or in front of a goal mouth: the back wall has a hole here. The nearest surfaces are
    // the floor, the goal's side walls and roof (or their front edges, the posts and crossbar,
    // while still out on the field) and the back of the net.
    let d = y; n.set(0, 1, 0);
    const dz = F.HZ - az, dx = F.GW - ax, dy = F.GH - y;
    let c;
    if (dz <= 0) {
      if (dx < d) { d = dx; n.set(-sx, 0, 0); }
      if (dy < d) { d = dy; n.set(0, -1, 0); }
    } else {
      c = Math.hypot(dx, dz); if (c < d) { d = c; n.set(-sx * dx / c, 0, -sz * dz / c); }
      c = Math.hypot(dy, dz); if (c < d) { d = c; n.set(0, -dy / c, -sz * dz / c); }
    }
    c = F.HZ + F.GD - az; if (c < d) { d = c; n.set(0, 0, -sz); }
    return d;
  }

  if (az > F.HZ) {
    // Behind the line of the back wall but not inside the goal: this is solid. Push back the
    // shortest way out, which is into the goal for something that has come through its side
    // or roof netting, and onto the pitch for anything else.
    let pen = az - F.HZ;
    n.set(0, 0, -sz);
    // the way back into the goal box, which may be diagonal at its back corners
    const px = Math.max(0, ax - F.GW), py = Math.max(0, y - F.GH), pb = Math.max(0, az - F.HZ - F.GD);
    const box = Math.hypot(px, py, pb);
    if (box > 0 && box < pen && box < 260) {
      pen = box;
      n.set(-sx * px / box, -py / box, -sz * pb / box);
    }
    return -pen;
  }

  // The main room: an eight-sided footprint, with a curve where the walls meet floor and ceiling.
  let f = ax - F.HX, gx = sx, gz = 0;
  const fz = az - F.HZ; if (fz > f) { f = fz; gx = 0; gz = sz; }
  const fc = (ax + az - CORNER_SUM) * SQ; if (fc > f) { f = fc; gx = sx * SQ; gz = sz * SQ; }
  const low = y < F.H / 2;
  const R = low ? F.RB : F.RT;
  const qy = low ? R - y : y - (F.H - R), sy = low ? -1 : 1;
  const qx = f + R;
  if (qx > 0 && qy > 0) {
    const l = Math.hypot(qx, qy);
    n.set(-gx * qx / l, -sy * qy / l, -gz * qx / l);
    return R - l;
  }
  if (qx > qy) { n.set(-gx, 0, -gz); return -f; }
  n.set(0, -sy, 0);
  return R - qy;
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

function curve(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) return lerp(table[i - 1][1], table[i][1], (x - table[i - 1][0]) / (table[i][0] - table[i - 1][0]));
  }
  return table[table.length - 1][1];
}
const THROTTLE_ACCEL = [[0, 1600], [1400, 160], [1410, 0]];
const TURN_CURVATURE = [[0, 0.0069], [500, 0.00398], [1000, 0.00235], [1500, 0.001375], [1750, 0.0011], [2300, 0.00088]];
const HIT_SCALE = [[0, 0.65], [500, 0.65], [2300, 0.55], [4600, 0.3]];

const tn = new Vector3(), tv = new Vector3(), tr = new Vector3(), tw = new Vector3(), tq = new Quaternion();
const t1 = new Vector3(), t2 = new Vector3(), t3 = new Vector3();

export class Ball {
  constructor() {
    this.pos = new Vector3(); this.vel = new Vector3(); this.ang = new Vector3(); this.quat = new Quaternion();
    this.reset();
  }

  reset() {
    this.pos.set(0, BALL_R, 0); this.vel.set(0, 0, 0); this.ang.set(0, 0, 0);
    this.touchedGround = false;
  }

  copy(b) {
    this.pos.copy(b.pos); this.vel.copy(b.vel); this.ang.copy(b.ang);
    return this;
  }

  // Returns the speed of the hardest bounce this tick, for sound.
  step(dt) {
    const { pos, vel, ang } = this;
    vel.y -= GRAVITY * dt;
    vel.multiplyScalar(1 - BALL_DRAG * dt);
    const speed = vel.length();
    if (speed > BALL_MAX) vel.multiplyScalar(BALL_MAX / speed);
    pos.addScaledVector(vel, dt);

    let impact = 0;
    this.touchedGround = false;
    for (let i = 0; i < 2; i++) {
      const d = arenaDist(pos, tn);
      if (d >= BALL_R) break;
      pos.addScaledVector(tn, BALL_R - d);
      if (tn.y > 0.9 && pos.y < BALL_R + 2) this.touchedGround = true;
      const vn = vel.dot(tn);
      if (vn >= 0) continue;
      const bounce = vn < -45 ? BALL_BOUNCE : 0;
      const jn = -(1 + bounce) * vn;
      vel.addScaledVector(tn, jn);
      impact = Math.max(impact, -vn);
      // friction at the contact point, which also sets the ball spinning (and lets it roll)
      tv.copy(vel).addScaledVector(tn, -vel.dot(tn));      // sliding velocity of the ball's centre
      tr.crossVectors(tn, ang).multiplyScalar(BALL_R);     // plus the spin: ang x (-n R)
      tv.add(tr);
      const slip = tv.length();
      if (slip > 0.01) {
        const dvt = Math.min(slip * (2 / 7), BALL_FRICTION * jn + 0.5);
        tv.multiplyScalar(-dvt / slip);
        vel.add(tv);
        tr.crossVectors(tv, tn).multiplyScalar(2.5 / BALL_R);
        ang.add(tr);
      }
      if (bounce === 0) {
        const s = vel.length();
        if (s > 0.01) vel.multiplyScalar(Math.max(0, s - BALL_ROLL_DECEL * dt) / s);
      }
    }
    const spin = ang.length();
    if (spin > 6) ang.multiplyScalar(6 / spin);
    if (spin > 1e-4) {
      tq.setFromAxisAngle(tv.copy(ang).normalize(), Math.min(spin, 6) * dt);
      this.quat.premultiply(tq).normalize();
    }
    return impact;
  }
}

export const newInput = () => ({ throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, slide: false });

export class Car {
  constructor(team, slot = 0) {
    this.team = team;   // 0 blue, 1 red
    this.slot = slot;
    this.pos = new Vector3(); this.vel = new Vector3(); this.ang = new Vector3(); this.quat = new Quaternion();
    this.fwd = new Vector3(0, 0, 1); this.left = new Vector3(1, 0, 0); this.up = new Vector3(0, 1, 0);
    this.normal = new Vector3(0, 1, 0);
    this.input = newInput();
    this.kinematic = false;   // a remote player's car: moved by the network, not simulated
    this.spawn(0);
  }

  spawn(spot) {
    const [x, z, yaw] = KICKOFFS[spot % KICKOFFS.length];
    const s = this.team === 0 ? 1 : -1;
    this.place(x * s, z * s, yaw + (this.team === 0 ? 0 : Math.PI));
    this.boost = CAR.BOOST_START;
  }

  place(x, z, yaw) {
    this.pos.set(x, CAR.REST, z);
    this.quat.setFromAxisAngle(tv.set(0, 1, 0), yaw);
    this.vel.set(0, 0, 0); this.ang.set(0, 0, 0);
    this.onGround = true; this.wheelsDown = 4; this.normal.set(0, 1, 0);
    this.jumped = false; this.jumpTime = 0; this.jumpHolding = false; this.airTime = 0;
    this.flipUsed = false; this.dodgeTime = -1; this.dodgeAngle = 0; this.dodgeAxis = this.dodgeAxis || new Vector3();
    this.prevJump = false; this.boosting = false; this.supersonic = false; this.sliding = false;
    this.demoed = false; this.respawnIn = 0; this.steerAngle = 0; this.wheelSpin = 0; this.groundGrace = 0;
    this.event = null;
    this.updateAxes();
  }

  updateAxes() {
    this.fwd.set(0, 0, 1).applyQuaternion(this.quat);
    this.left.set(1, 0, 0).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
  }

  demolish() {
    if (this.demoed) return;
    this.demoed = true; this.respawnIn = 3; this.event = 'demo';
    this.vel.set(0, 0, 0); this.ang.set(0, 0, 0); this.boosting = false;
  }

  // `event` is set to 'jump', 'dodge', 'land' or 'demo' on the tick it happens, for sound and effects.
  step(dt, inp = this.input) {
    this.event = null;
    if (this.demoed) {
      this.respawnIn -= dt;
      if (this.respawnIn <= 0) { this.spawn(this.slot + 2 + Math.floor(Math.random() * 3)); this.event = 'respawn'; }
      return;
    }
    const { pos, vel, ang, quat, fwd, left, up } = this;
    this.updateAxes();

    // ---- which wheels are on a surface
    let down = 0;
    t1.set(0, 0, 0);
    for (const w of WHEELS) {
      tw.set(w[0], w[1], w[2]).applyQuaternion(quat).add(pos);
      if (arenaDist(tw, tn) < 4) { down++; t1.add(tn); }
    }
    this.groundGrace -= dt;
    const wasGround = this.onGround;
    let grounded = down >= 2 && this.groundGrace <= 0;
    if (grounded) { t1.normalize(); grounded = t1.dot(up) > 0.65; }
    this.wheelsDown = down;
    this.onGround = grounded;
    const jumpPressed = inp.jump && !this.prevJump;
    this.prevJump = inp.jump;
    this.boosting = inp.boost && this.boost > 0;
    this.sliding = false;

    if (grounded) {
      const n = this.normal.copy(t1);
      if (!wasGround) this.event = 'land';
      this.jumped = false; this.flipUsed = false; this.airTime = 0; this.dodgeTime = -1; this.jumpHolding = false;

      // sit flat on the surface
      tq.setFromUnitVectors(up, n);
      t2.set(tq.x, tq.y, tq.z);
      const a = 1 - Math.exp(-45 * dt);
      tq.set(t2.x * a, t2.y * a, t2.z * a, 1 - a + tq.w * a).normalize();
      quat.premultiply(tq).normalize();
      this.updateAxes();

      let vf = vel.dot(fwd);
      const vn = vel.dot(n);
      const throttle = this.boosting ? 1 : clamp(inp.throttle, -1, 1);
      this.sliding = inp.slide && Math.abs(vf) > 200;

      // steering turns the car, and the tyres drag the velocity round with it
      const steer = clamp(inp.steer, -1, 1);
      this.steerAngle = lerp(this.steerAngle, steer * 0.5, Math.min(1, dt * 14));
      const yawRate = -steer * curve(TURN_CURVATURE, Math.abs(vf)) * vf * (inp.slide ? 1.6 : 0.88);
      const dYaw = yawRate * dt;
      tq.setFromAxisAngle(n, dYaw);
      quat.premultiply(tq).normalize();
      t2.copy(vel).addScaledVector(n, -vn);                         // velocity along the surface
      t2.applyAxisAngle(n, dYaw * (inp.slide ? 0.35 : 1));
      this.updateAxes();
      vf = t2.dot(fwd);
      let vl = t2.dot(left);
      vl *= Math.exp(-(inp.slide ? 1.3 : 9) * dt);

      if (throttle !== 0 && throttle * vf >= 0) vf += throttle * curve(THROTTLE_ACCEL, Math.abs(vf)) * dt;
      else if (throttle !== 0) vf += throttle * CAR.BRAKE * dt;
      else vf -= Math.sign(vf) * Math.min(Math.abs(vf), CAR.COAST * dt);
      if (this.boosting) vf += CAR.BOOST_ACCEL * dt;

      vel.copy(fwd).multiplyScalar(vf).addScaledVector(left, vl).addScaledVector(n, vn);
      vel.addScaledVector(n, -CAR.STICKY * dt);
      vel.y -= GRAVITY * dt;
      ang.copy(n).multiplyScalar(yawRate);
      this.wheelSpin += vf * dt / 17;

      if (jumpPressed) {
        vel.addScaledVector(up, CAR.JUMP);
        this.jumped = true; this.jumpTime = 0; this.jumpHolding = true;
        this.onGround = false; this.groundGrace = 0.08; this.event = 'jump';
      }
    } else {
      this.airTime += dt;
      const stuck = down < 2 && this.touching && vel.lengthSq() < 400 * 400;

      // holding jump keeps pushing for a moment, which is what makes a held jump higher
      if (this.jumpHolding) {
        this.jumpTime += dt;
        if (inp.jump && this.jumpTime < CAR.JUMP_HOLD_TIME) vel.addScaledVector(up, CAR.JUMP_HOLD_ACCEL * dt);
        else this.jumpHolding = false;
      }

      const canFlip = !this.flipUsed && (!this.jumped || this.airTime < CAR.FLIP_WINDOW + CAR.JUMP_HOLD_TIME);
      if (jumpPressed && stuck) {
        // on its roof or side: hop and roll back onto the wheels
        vel.addScaledVector(this.normal, 330);
        ang.addScaledVector(fwd, (t2.crossVectors(up, this.normal).dot(fwd) >= 0 ? 1 : -1) * 5.5);
        this.event = 'jump';
      } else if (jumpPressed && canFlip) {
        this.flipUsed = true; this.jumpHolding = false;
        const df = -inp.pitch, ds = inp.yaw || inp.steer;
        const mag = Math.hypot(df, ds);
        if (mag > 0.4) {
          // dodge: a burst of speed in that direction, and a flip
          const f = df / mag, s = ds / mag;
          t2.copy(fwd); t2.y = 0; t2.normalize();           // heading on the ground plane
          t3.set(t2.z, 0, -t2.x);                           // left of that heading
          const pace = Math.min(1, Math.hypot(vel.x, vel.z) / CAR.MAX_SPEED);
          const goingBack = vel.dot(t2) * f < 0 && f < 0;
          const fwdKick = f * (f < 0 || goingBack ? 533 * (1 + 1.5 * pace) : CAR.DODGE);
          const sideKick = s * CAR.DODGE * (1 + 0.9 * pace);
          vel.addScaledVector(t2, fwdKick).addScaledVector(t3, -sideKick);
          this.dodgeAxis.copy(left).multiplyScalar(f).addScaledVector(fwd, s).normalize();
          this.dodgeTime = 0; this.dodgeAngle = 0;
          this.event = 'dodge';
        } else {
          vel.addScaledVector(up, CAR.JUMP);
          this.event = 'jump';
        }
      }

      if (this.dodgeTime >= 0) {
        // flipping: one full turn about the dodge axis, with no falling for most of it
        this.dodgeTime += dt;
        const step = CAR.DODGE_SPIN * dt;
        this.dodgeAngle += step;
        ang.copy(this.dodgeAxis).multiplyScalar(CAR.DODGE_SPIN);
        if (this.dodgeTime > 0.15 && this.dodgeTime < CAR.DODGE_TIME) vel.y *= Math.pow(0.65, dt * 120);
        if (this.dodgeAngle >= Math.PI * 2 - step) { this.dodgeTime = -1; ang.set(0, 0, 0); }
      } else {
        // air control: pitch, yaw and roll, each with its own strength and damping
        const p = clamp(inp.pitch, -1, 1), yw = clamp(inp.yaw, -1, 1), r = clamp(inp.roll, -1, 1);
        const wp = ang.dot(left), wy = ang.dot(up), wr = ang.dot(fwd);
        ang.addScaledVector(left, (-p * 12.146 - wp * 2.798 * (1 - Math.abs(p))) * dt);
        ang.addScaledVector(up, (-yw * 8.92 - wy * 1.886 * (1 - Math.abs(yw))) * dt);
        ang.addScaledVector(fwd, (r * 36.08 - wr * 4.472) * dt);
        const spin = ang.length();
        if (spin > CAR.MAX_SPIN) ang.multiplyScalar(CAR.MAX_SPIN / spin);
      }

      if (stuck) {
        // lying on its roof or side: roll back over by itself
        const dir = t2.crossVectors(up, this.normal).dot(fwd) >= 0 ? 1 : -1;
        ang.addScaledVector(fwd, dir * 26 * dt);
      }

      vel.y -= GRAVITY * dt;
      if (this.boosting) vel.addScaledVector(fwd, CAR.BOOST_ACCEL * dt);
      else if (inp.throttle) vel.addScaledVector(fwd, inp.throttle * (inp.throttle > 0 ? CAR.AIR_THROTTLE : CAR.AIR_THROTTLE / 2) * dt);
      this.steerAngle = lerp(this.steerAngle, 0, Math.min(1, dt * 10));
    }

    if (this.boosting) this.boost = Math.max(0, this.boost - CAR.BOOST_USE * dt);
    const speed = vel.length();
    if (speed > CAR.MAX_SPEED) vel.multiplyScalar(CAR.MAX_SPEED / speed);
    this.supersonic = speed >= (this.supersonic ? CAR.SUPERSONIC - 100 : CAR.SUPERSONIC);

    pos.addScaledVector(vel, dt);
    const spin = ang.length();
    if (spin > 1e-5) {
      tq.setFromAxisAngle(tv.copy(ang).multiplyScalar(1 / spin), spin * dt);
      quat.premultiply(tq).normalize();
    }
    this.collideArena(this.onGround);
    this.updateAxes();
  }

  // Keeps the car out of the walls. On its wheels this only stops it sinking in; in the air the
  // body is a rigid box, so a bad landing bounces and tumbles until the wheels come down.
  collideArena(grounded) {
    const { pos, vel, ang, quat } = this;
    let deepest = 0, touching = false;
    t3.set(0, 0, 0);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < 12; i++) {
        const c = i < 4 ? WHEELS[i] : CORNERS[i - 4];
        tr.set(c[0], c[1], c[2]).applyQuaternion(quat);     // from the centre to this point
        tw.copy(tr).add(pos);
        const d = arenaDist(tw, tn);
        if (d >= 0) continue;
        touching = true;
        if (pass === 0 && -d > deepest) { deepest = -d; t3.copy(tn); }
        if (grounded) {
          const vn = vel.dot(tn);
          if (vn < 0) vel.addScaledVector(tn, -vn);
          continue;
        }
        tv.crossVectors(ang, tr).add(vel);                  // velocity of this point
        const vn = tv.dot(tn);
        if (vn >= 0) continue;
        // impulse along the normal
        t1.crossVectors(tr, tn);
        applyInvInertia(t1, quat);
        const k = 1 + t2.crossVectors(t1, tr).dot(tn);
        const j = -(vn < -350 ? 1.25 : 1) * vn / k;
        vel.addScaledVector(tn, j);
        t1.crossVectors(tr, tn).multiplyScalar(j);
        ang.add(applyInvInertia(t1, quat));
        // friction
        tv.addScaledVector(tn, -vn);
        const slip = tv.length();
        if (slip > 1) {
          const jt = Math.min(0.35 * j, slip / k);
          tv.multiplyScalar(-jt / slip);
          vel.add(tv);
          t1.crossVectors(tr, tv);
          ang.add(applyInvInertia(t1, quat));
        }
      }
    }
    if (deepest > 0) {
      pos.addScaledVector(t3, deepest);
      if (!grounded) { this.normal.copy(t3); ang.multiplyScalar(0.985); }
    }
    this.touching = touching;
  }
}

function applyInvInertia(v, quat) {
  tq.copy(quat).conjugate();
  v.applyQuaternion(tq).multiply(INV_INERTIA);
  return v.applyQuaternion(quat);
}

const cq = new Quaternion(), cl = new Vector3(), cn = new Vector3(), cr = new Vector3(), cv = new Vector3(), cd = new Vector3();

// Car against ball. Returns how hard the touch was (relative speed), or 0 for none.
export function hitBall(car, ball) {
  if (car.demoed) return 0;
  cq.copy(car.quat).conjugate();
  cl.copy(ball.pos).sub(car.pos);
  if (cl.lengthSq() > 200 * 200) return 0;
  cl.applyQuaternion(cq);
  cr.set(clamp(cl.x, -CAR.HX, CAR.HX), clamp(cl.y, -CAR.HY, CAR.HY), clamp(cl.z, -CAR.HZ, CAR.HZ));
  cn.copy(cl).sub(cr);
  let dist = cn.length();
  if (dist >= BALL_R) return 0;
  if (dist < 1e-4) { cn.set(0, 1, 0); dist = 0; } else cn.multiplyScalar(1 / dist);
  cn.applyQuaternion(car.quat);          // contact normal, car to ball
  cr.applyQuaternion(car.quat);          // contact point relative to the car
  ball.pos.addScaledVector(cn, BALL_R - dist);

  cv.crossVectors(car.ang, cr).add(car.vel);      // car's velocity at the contact
  cv.subVectors(ball.vel, cv);                    // ball relative to it
  const vn = cv.dot(cn);
  if (vn >= 0) return 0;
  const power = cv.length();
  const j = -1.1 * vn / (1 / BALL_MASS + 1 / CAR_MASS);
  ball.vel.addScaledVector(cn, j / BALL_MASS);
  if (!car.kinematic) car.vel.addScaledVector(cn, -j / CAR_MASS);

  // Rocket League's own extra push, on top of the plain collision: away from the car's centre,
  // flattened, and stronger for slow touches than fast ones
  cd.copy(ball.pos).sub(car.pos);
  cd.y *= 0.35;
  cd.normalize();
  cd.addScaledVector(car.fwd, -0.35 * cd.dot(car.fwd)).normalize();
  ball.vel.addScaledVector(cd, power * curve(HIT_SCALE, power));

  // a glancing touch spins the ball
  cv.addScaledVector(cn, -vn);
  cd.crossVectors(cn, cv).multiplyScalar(0.35 / BALL_R);
  ball.ang.add(cd);
  const speed = ball.vel.length();
  if (speed > BALL_MAX) ball.vel.multiplyScalar(BALL_MAX / speed);
  return power;
}

const SPHERES = [34, -34], SPHERE_R = 44;
const pa = new Vector3(), pb = new Vector3();

// Car against car: bumps, and a demolition when one of them is supersonic. Returns 'bump', 'demo' or null.
export function hitCars(a, b) {
  if (a.demoed || b.demoed || a.pos.distanceToSquared(b.pos) > 220 * 220) return null;
  let result = null;
  for (const za of SPHERES) for (const zb of SPHERES) {
    pa.copy(a.fwd).multiplyScalar(za).add(a.pos);
    pb.copy(b.fwd).multiplyScalar(zb).add(b.pos);
    cn.subVectors(pb, pa);
    const dist = cn.length();
    if (dist >= SPHERE_R * 2 || dist < 1e-3) continue;
    cn.multiplyScalar(1 / dist);
    const overlap = SPHERE_R * 2 - dist;
    const wa = a.kinematic ? 0 : b.kinematic ? 1 : 0.5;
    a.pos.addScaledVector(cn, -overlap * wa);
    b.pos.addScaledVector(cn, overlap * (b.kinematic ? 0 : 1 - wa));
    const vn = cv.subVectors(b.vel, a.vel).dot(cn);
    if (vn >= 0) continue;
    if (a.team !== b.team && -vn > 500) {
      // whoever is supersonic and driving into the other wins
      const aIn = a.vel.dot(cn), bIn = -b.vel.dot(cn);
      if (a.supersonic && aIn > bIn && !b.kinematic) { b.demolish(); return 'demo'; }
      if (b.supersonic && bIn > aIn && !a.kinematic) { a.demolish(); return 'demo'; }
    }
    const j = -1.3 * vn;
    if (!a.kinematic) a.vel.addScaledVector(cn, -j * (b.kinematic ? 1 : 0.5));
    if (!b.kinematic) b.vel.addScaledVector(cn, j * (a.kinematic ? 1 : 0.5));
    result = -vn > 250 ? 'bump' : result;
  }
  return result;
}

// Boost pads a car is driving over. `timers` holds seconds until each pad returns (0 = ready).
export function collectPads(car, timers, onPick) {
  if (car.demoed || car.boost >= 100) return;
  for (let i = 0; i < PADS.length; i++) {
    if (timers[i] > 0) continue;
    const [x, z, big] = PADS[i];
    const r = big ? 208 : 144;
    const dx = car.pos.x - x, dz = car.pos.z - z;
    if (dx * dx + dz * dz > r * r || car.pos.y > 165) continue;
    timers[i] = big ? PAD_BIG_TIME : PAD_SMALL_TIME;
    car.boost = big ? 100 : Math.min(100, car.boost + 12);
    onPick(i, big, car);
    if (car.boost >= 100) return;
  }
}

// Where the ball will be: `out` is filled with positions every `dt` seconds.
const ghost = new Ball();
export function predictBall(ball, out, steps, dt = 1 / 30) {
  ghost.copy(ball);
  for (let i = 0; i < steps; i++) {
    ghost.step(dt / 2); ghost.step(dt / 2);
    (out[i] || (out[i] = new Vector3())).copy(ghost.pos);
  }
  return out;
}

export const isGoal = (ball) => Math.abs(ball.pos.z) > F.HZ + BALL_R ? (ball.pos.z > 0 ? 0 : 1) : -1;   // the team that scored
