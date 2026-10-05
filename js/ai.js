// Computer players. A bot looks at where the ball is going to be, picks the earliest point it
// can really reach (counting the time to turn, speed up and, for a ball in the air, jump), and
// arrives there on time so the touch sends the ball at the other goal. When it is on the wrong
// side of the ball it gets back goal-side instead of chasing, and it saves shots that are on
// their way in. With team-mates, the one who can get there first goes, the next backs up and
// the last one minds the goal.
import { Vector3 } from 'three';
import { F, BALL_R, PADS, CAR } from './physics.js';

// jump: 0 stays on the ground, 1 jumps for the ball, 2 double jumps for the high ones
const LEVELS = {
  easy: { think: 0.25, throttle: 0.75, boost: 0, dodge: 0.2, jump: 0, error: 230, shadow: false },
  medium: { think: 0.1, throttle: 1, boost: 0.5, dodge: 0.75, jump: 1, error: 90, shadow: true },
  hard: { think: 1 / 30, throttle: 1, boost: 1, dodge: 1, jump: 2, error: 15, shadow: true },
};
const GROUND_REACH = 120;                 // a ball lower than this can be hit without jumping
const MAX_Y = [GROUND_REACH, 300, 470];   // highest ball each jump setting goes for

// How high a held jump (and a double jump) has lifted the car, every 1/120 s.
function riseTable(double) {
  const out = [];
  let y = 0, v = CAR.JUMP, second = !double;
  for (let i = 0; i < 150; i++) {
    const t = i / 120;
    if (t < CAR.JUMP_HOLD_TIME) v += CAR.JUMP_HOLD_ACCEL / 120;
    if (!second && t >= 0.26) { v += CAR.JUMP; second = true; }
    v -= 650 / 120;
    y += v / 120;
    out.push(y);
  }
  return out;
}
const RISE = [riseTable(false), riseTable(true)];
function riseTime(table, h) {
  for (let i = 0; i < table.length; i++) { if (table[i] >= h) return i / 120; if (i > 30 && table[i] < table[i - 1]) break; }
  return -1;
}

const goal = new Vector3(), dir = new Vector3(), tmp = new Vector3(), tmp2 = new Vector3();
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const flatDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Roughly how long a car needs to drive to a point: the turn, then the run.
function eta(c, p, boost) {
  tmp2.subVectors(p, c.pos);
  const d = Math.max(0, Math.hypot(tmp2.x, tmp2.z) - 110);
  const angle = Math.abs(Math.atan2(tmp2.dot(c.left), tmp2.dot(c.fwd)));
  const v = Math.max(0, c.vel.dot(c.fwd));
  const top = boost && c.boost > 15 ? 2150 : 1400;
  const pace = v >= top ? v : top - (top - v) * Math.min(1, 700 / (d + 1));
  return d / Math.max(pace, 500) + angle * 0.38 + (c.onGround ? 0 : 0.35);
}

export class Bot {
  constructor(car, level = 'medium') {
    this.car = car;
    this.level = LEVELS[level] || LEVELS.medium;
    this.target = new Vector3();
    this.hit = new Vector3();     // where it means to meet the ball
    this.shot = new Vector3();    // the way the ball should leave
    this.hitAt = -1;              // when (on this.clock), or -1 for no appointment
    this.need = 0; this.double = false;   // how far it must jump for that touch
    this.clock = 0;
    this.timer = Math.random() * 0.1;
    this.mode = 'attack';
    this.seq = null;          // a jump or dodge in progress
    this.cooldown = 0;
    this.stuck = 0; this.reverse = 0;
    this.aim = new Vector3();
  }

  // world: { ball, cars, prediction: Vector3[] at 1/30 s steps, age: seconds since it was made,
  //          pads: timers, kickoff: bool }
  update(dt, world) {
    const { car, level } = this;
    const inp = car.input;
    if (car.demoed) return;
    this.clock += dt;
    this.timer -= dt; this.cooldown -= dt;
    if (this.timer <= 0) { this.timer = level.think; this.decide(world); }

    const { ball } = world;
    const speed = car.vel.length();
    const onWall = car.onGround && car.up.y < 0.6;
    if (onWall) this.target.set(car.pos.x * 0.7, 0, car.pos.z * 0.7);    // come back down
    tmp.copy(this.target).sub(car.pos);
    const dist = tmp.length();
    const angle = Math.atan2(tmp.dot(car.left), tmp.dot(car.fwd));   // positive: target is to the left
    tmp.copy(ball.pos).sub(car.pos);
    const ballAngle = Math.atan2(tmp.dot(car.left), tmp.dot(car.fwd));
    const ballDist = Math.hypot(tmp.x, tmp.z), ballGap = tmp.length();
    const toward = (tmp.x * this.shot.x + tmp.z * this.shot.z) / (ballDist + 1);   // 1: the ball is straight ahead along the shot
    const closing = ((car.vel.x - ball.vel.x) * tmp.x + (car.vel.z - ball.vel.z) * tmp.z) / (ballDist + 1);

    inp.jump = false; inp.boost = false; inp.slide = false; inp.pitch = 0; inp.yaw = 0; inp.roll = 0;
    inp.steer = clamp(-angle * 2.6, -1, 1);
    inp.throttle = level.throttle;

    if (this.seq) {
      const s = this.seq;
      s.t += dt;
      inp.boost = level.boost > 0 && car.onGround;
      if (s.kind === 'dodge') {
        // jump, let go, then jump again while pushing toward the ball
        if (s.t < 0.06) inp.jump = true;
        else if (s.t < 0.11) inp.jump = false;
        else if (s.t < 0.18) { inp.jump = true; inp.pitch = -1; inp.steer = s.straight ? 0 : clamp(-ballAngle * 2, -1, 1); }
        else { this.seq = null; this.cooldown = 1.1; }
      } else if (s.kind === 'double') {
        // two jumps straight up for a high ball
        inp.steer = 0;
        if (s.t < 0.2) inp.jump = true;
        else if (s.t < 0.26) inp.jump = false;
        else if (s.t < 0.33) inp.jump = true;
        else { inp.pitch = clamp(-car.fwd.y * 3, -1, 1); if (s.t > s.until || car.onGround) { this.seq = null; this.cooldown = 0.5; } }
      } else {
        // a held jump up to the ball, then flip into it for power
        if (s.t < 0.2) { inp.jump = true; inp.steer = 0; }
        else if (s.flip === undefined) {
          inp.steer = 0;
          inp.pitch = clamp(-car.fwd.y * 3, -1, 1);
          if (level.dodge && ballGap < 215 && Math.abs(ballAngle) < 0.7) s.flip = s.t;
          else if (s.t > s.until || car.onGround) { this.seq = null; this.cooldown = 0.4; }
        } else if (s.t < s.flip + 0.07) { inp.jump = true; inp.pitch = -1; inp.steer = clamp(-ballAngle * 2, -1, 1); }
        else { this.seq = null; this.cooldown = 0.9; }
      }
      return;
    }

    if (!car.onGround) {
      // in the air: level out so it lands on its wheels
      inp.roll = clamp(-car.left.y * 3 - (car.up.y < 0 ? Math.sign(car.left.y || 1) : 0), -1, 1);
      inp.pitch = clamp(-car.fwd.y * 3, -1, 1);
      inp.steer = 0;
      if (car.touching && speed < 200 && this.cooldown <= 0) { inp.jump = true; this.cooldown = 0.6; }
      return;
    }

    // wedged against something: back out
    if (speed < 60 && !world.frozen) this.stuck += dt; else this.stuck = 0;
    if (this.stuck > 1.2) { this.reverse = 0.7; this.stuck = 0; }
    if (this.reverse > 0) { this.reverse -= dt; inp.throttle = -1; inp.steer = -inp.steer; return; }

    if (Math.abs(angle) > 1.25 && speed > 500) inp.slide = true;
    if (onWall) return;
    const lined = Math.abs(angle) < 0.28;
    if (this.mode === 'support' || this.mode === 'pad') {
      if (dist < 350 && this.mode === 'support') inp.throttle = speed > 300 ? -0.4 : 0;
      else if (dist < 1200 && this.mode === 'support') inp.throttle = 0.5;
      else if (level.boost >= 1 && lined && dist > 2800 && speed < 1700 && car.boost > 40) inp.boost = true;
      return;
    }

    // keep the appointment: no faster than it takes to meet the ball as it arrives
    const left = this.hitAt - this.clock;
    let hurry = dist > 1100;
    if (this.hitAt >= 0 && left > 0.05) {
      const want = (dist + flatDist(this.target, this.hit) - BALL_R) / left;
      hurry = want > speed + 80;
      if (speed > want + 350) inp.throttle = -1;
      else if (speed > want + 50) inp.throttle = 0;
    }
    const keen = level.boost >= 1 || this.mode !== 'attack' || world.kickoff || dist > 2200;
    if (level.boost && lined && speed < 2250 && (hurry || world.kickoff) && car.boost > 0 && keen) inp.boost = true;

    // out of boost with a long way to go: flip forward for the speed
    if (level.dodge >= 0.7 && hurry && Math.abs(angle) < 0.08 && dist > 2200 && speed > 900 && speed < 1900 && car.boost < 3 && this.cooldown <= 0 && !world.kickoff) {
      this.seq = { t: 0, kind: 'dodge', straight: true };
      return;
    }

    if (this.cooldown > 0 || this.mode === 'behind' || this.mode === 'retreat') return;

    // the ball is coming down to meet it: jump so they arrive together
    if (this.need > 0 && left > 0) {
      const rise = riseTime(RISE[this.double ? 1 : 0], this.need);
      tmp.copy(this.hit).sub(car.pos);
      const gap = Math.hypot(tmp.x, tmp.z);
      const square = Math.abs(Math.atan2(tmp.dot(car.left), tmp.dot(car.fwd))) < 0.22;
      if (rise >= 0 && left <= rise + 0.03 && left > rise - 0.12 && square && Math.abs(gap - 70 - speed * left) < 130) {
        this.seq = { t: 0, kind: this.double ? 'double' : 'jump', until: left + 0.35 };
      }
      return;
    }

    // closing on the ball, pointing at it and behind it: flip into it
    // (started a quarter of a second out, so the flip lands as the car gets there)
    if (Math.abs(ballAngle) < 0.45 && ball.pos.y < 190 && closing > 200 && ballDist - 150 < closing * 0.26 && (toward > 0.3 || world.kickoff)) {
      if (Math.random() < level.dodge) this.seq = { t: 0, kind: 'dodge' };
      else this.cooldown = 0.25;
    }
  }

  decide(world) {
    const { car, level } = this;
    const { ball, prediction, cars } = world;
    const side = car.team === 0 ? 1 : -1;            // which way this bot attacks along z
    const age = world.age || 0;
    this.hitAt = -1; this.need = 0;

    // team-mates: whoever is nearer takes the ball, the others line up behind
    const mine = flatDist(car.pos, ball.pos) + ((car.pos.z - ball.pos.z) * side > 0 ? 900 : 0);
    let rank = 0;
    for (const other of cars) {
      if (other === car || other.team !== car.team || other.demoed) continue;
      const theirs = flatDist(other.pos, ball.pos) + ((other.pos.z - ball.pos.z) * side > 0 ? 900 : 0);
      if (theirs + 250 < mine || (Math.abs(theirs - mine) <= 250 && other.slot < car.slot)) rank++;
    }

    // is the ball on its way into our goal?
    let threat = prediction.length;
    for (let i = 0; i < prediction.length; i++) {
      const p = prediction[i];
      if (p.z * side < -F.HZ + 40 && Math.abs(p.x) < F.GW + 80 && p.y < F.GH + 80) { threat = i; break; }
    }
    const shotOnUs = threat < prediction.length;

    // the earliest point on the ball's path this car can get to in time, jumping if it has to
    let hit = ball.pos, hitTime = 0, need = 0, double = false, found = false;
    for (let i = 0; i < threat; i++) {
      const p = prediction[i], t = (i + 1) / 30 - age;
      if (t <= 0 || p.y > MAX_Y[level.jump] || Math.abs(p.z) > F.HZ) continue;
      let h = 0, dbl = false;
      if (p.y > GROUND_REACH) {
        h = p.y - 105;
        let rise = riseTime(RISE[0], h);
        if (rise < 0 || p.y > 290) { dbl = true; rise = riseTime(RISE[1], h); }
        if (rise < 0 || rise + 0.1 > t) continue;
      }
      hit = p; hitTime = t; need = h; double = dbl;
      if (eta(car, p, level.boost) <= t) { found = true; break; }
    }

    if (rank > 0 && !(shotOnUs && found)) {
      // second man sits behind the play on the far side; anyone after that stays near goal
      this.mode = 'support';
      if (rank === 1) this.target.set(clamp(ball.pos.x * 0.45 - Math.sign(ball.pos.x || 1) * 500, -2600, 2600), 0, clamp(ball.pos.z - side * 2600, -F.HZ + 500, F.HZ - 500));
      else this.target.set(clamp(ball.pos.x * 0.2, -700, 700), 0, -side * (F.HZ - 700));
      if (level.boost && car.boost < 35 && !world.kickoff) this.findPad(world, this.target, 1500);
      return;
    }

    if (world.kickoff) { this.mode = 'attack'; this.shot.set(0, 0, side); this.target.set(0, 0, -side * 60); return; }

    // low on boost and the ball is a long way off: fetch some
    if (level.boost && car.boost < 12 && !shotOnUs && flatDist(car.pos, ball.pos) > 2600 && ball.pos.z * side > -1500 && this.findPad(world, car.pos, 1700)) return;

    // where the touch should send the ball
    const danger = shotOnUs || hit.z * side < -F.HZ * 0.4;
    if (danger) {
      goal.set(0, 0, -side * F.HZ); dir.subVectors(hit, goal);            // away from our goal
      dir.y = 0; dir.normalize();
      if (Math.abs(dir.z) < 0.35) { dir.z = side * 0.35; dir.normalize(); }
    } else {
      goal.set(clamp(hit.x * 0.3, -550, 550), 0, side * F.HZ); dir.subVectors(goal, hit);
      dir.y = 0; dir.normalize();
    }
    this.shot.copy(dir);
    this.hit.copy(hit);

    if (Math.random() < level.think) this.aim.set((Math.random() - 0.5) * 2 * level.error, 0, (Math.random() - 0.5) * 2 * level.error);

    // how well the run-up already lines up with the shot: 1 straight behind it, -1 dead wrong side
    tmp.subVectors(hit, car.pos); tmp.y = 0;
    const run = tmp.length();
    const straight = run > 1 ? tmp.dot(dir) / run : 1;
    const wrongSide = (car.pos.z - hit.z) * side > 80;

    if (level.shadow && wrongSide && straight < 0.2 && !shotOnUs) {
      // beaten to it and facing the wrong way: get back between the ball and our goal
      let rival = 9;
      for (const other of cars) if (other.team !== car.team && !other.demoed) rival = Math.min(rival, eta(other, hit, true));
      if (rival < hitTime + 0.4 || run > 1500) {
        this.mode = 'retreat';
        this.target.set(hit.x * 0.45, 0, clamp((hit.z - side * F.HZ) * 0.5, -F.HZ + 300, F.HZ - 300));
        return;
      }
    }

    if (straight < (danger ? -0.1 : 0.25) && run > 250) {
      // get round behind the ball first, rather than driving through it
      this.mode = 'behind';
      const wide = (car.pos.x >= hit.x ? 1 : -1) * (danger ? 300 : 420);
      this.target.copy(hit).addScaledVector(dir, danger ? -450 : -900).add(tmp.set(wide, 0, 0));
    } else {
      this.mode = danger ? 'clear' : 'attack';
      this.target.copy(hit).addScaledVector(dir, -(BALL_R + 48)).add(this.aim);
      if (found) { this.hitAt = this.clock + hitTime; this.need = need; this.double = double; }
    }
    this.target.x = clamp(this.target.x, -F.HX + 150, F.HX - 150);
    this.target.z = clamp(this.target.z, -F.HZ + 120, F.HZ - 120);
    this.target.y = 0;
  }

  // Heads for the nearest boost pad that is up, within `range` of `from`. Returns whether there is one.
  findPad(world, from, range) {
    let best = -1, bestD = range;
    for (let i = 0; i < PADS.length; i++) {
      if (world.pads[i] > 0) continue;
      const d = Math.hypot(PADS[i][0] - from.x, PADS[i][1] - from.z) - (PADS[i][2] ? 500 : 0);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) return false;
    this.mode = 'pad';
    this.target.set(PADS[best][0], 0, PADS[best][1]);
    return true;
  }
}
