// Computer players. A bot looks at where the ball is going to be, picks the earliest point it
// can reach, and lines up so the touch sends the ball at the other goal. With team-mates, the
// one who can get there first goes; the rest hang back in support.
import { Vector3 } from 'three';
import { F, BALL_R, PADS } from './physics.js';

const LEVELS = {
  easy: { think: 0.28, throttle: 0.72, boost: 0, dodge: 0, reach: 130, error: 260, aerial: false },
  medium: { think: 0.12, throttle: 1, boost: 0.5, dodge: 0.5, reach: 190, error: 110, aerial: false },
  hard: { think: 0.04, throttle: 1, boost: 1, dodge: 1, reach: 330, error: 25, aerial: true },
};

const goal = new Vector3(), dir = new Vector3(), tmp = new Vector3();
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const flatDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class Bot {
  constructor(car, level = 'medium') {
    this.car = car;
    this.level = LEVELS[level] || LEVELS.medium;
    this.target = new Vector3();
    this.timer = Math.random() * 0.1;
    this.mode = 'attack';
    this.seq = null;          // a jump-then-dodge in progress
    this.cooldown = 0;
    this.stuck = 0; this.reverse = 0;
    this.aim = new Vector3();
  }

  // world: { ball, cars, prediction: Vector3[] at 1/30 s steps, pads: timers, kickoff: bool }
  update(dt, world) {
    const { car, level } = this;
    const inp = car.input;
    if (car.demoed) return;
    this.timer -= dt; this.cooldown -= dt;
    if (this.timer <= 0) { this.timer = level.think; this.decide(world); }

    const { ball } = world;
    const speed = car.vel.length();
    tmp.copy(this.target).sub(car.pos);
    const dist = tmp.length();
    const angle = Math.atan2(tmp.dot(car.left), tmp.dot(car.fwd));   // positive: target is to the left
    tmp.copy(ball.pos).sub(car.pos);
    const ballAngle = Math.atan2(tmp.dot(car.left), tmp.dot(car.fwd));
    const ballDist = Math.hypot(tmp.x, tmp.z);

    inp.jump = false; inp.boost = false; inp.slide = false; inp.pitch = 0; inp.yaw = 0; inp.roll = 0;
    inp.steer = clamp(-angle * 2.6, -1, 1);
    inp.throttle = level.throttle;

    if (this.seq) {
      // jump, let go, then jump again while pushing toward the ball: a dodge
      const s = this.seq;
      s.t += dt;
      if (s.t < s.hold) inp.jump = true;
      else if (s.t < s.hold + 0.05) inp.jump = false;
      else if (s.t < s.hold + 0.12) { inp.jump = true; inp.pitch = -1; inp.steer = clamp(-ballAngle * 2, -1, 1); }
      else { this.seq = null; this.cooldown = 1.1; }
      inp.boost = level.boost > 0 && car.onGround;
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
    if (this.mode === 'support' || this.mode === 'pad') {
      if (dist < 350 && this.mode === 'support') inp.throttle = speed > 300 ? -0.4 : 0;
      else if (dist < 1200 && this.mode === 'support') inp.throttle = 0.5;
      return;
    }

    const lined = Math.abs(angle) < 0.28;
    if (level.boost && lined && speed < 2250 && (dist > 1100 || world.kickoff) && car.boost > 0 && (level.boost >= 1 || this.mode === 'clear' || world.kickoff)) inp.boost = true;

    // close and pointing at it: jump or dodge into the ball
    if (this.cooldown <= 0 && Math.abs(ballAngle) < 0.4 && this.mode !== 'behind') {
      const closing = 280 + speed * 0.14;
      if (level.dodge && ball.pos.y < 190 && ballDist < closing && Math.random() < level.dodge + 0.3) this.seq = { t: 0, hold: 0.06 };
      else if (level.aerial && ball.pos.y >= 190 && ball.pos.y < 430 && ballDist < closing + 60 && ball.vel.y < 250) this.seq = { t: 0, hold: 0.2 };
      else if (ballDist < closing) this.cooldown = 0.25;
    }
  }

  decide(world) {
    const { car, level } = this;
    const { ball, prediction, cars } = world;
    const side = car.team === 0 ? 1 : -1;            // which way this bot attacks along z
    const speed = car.vel.length();

    // the earliest point on the ball's path this car can get to in time
    let hit = ball.pos, hitTime = 0;
    const pace = Math.max(speed, car.boost > 20 && level.boost ? 1750 : 1300);
    for (let i = 0; i < prediction.length; i++) {
      const p = prediction[i];
      if (p.y > level.reach || Math.abs(p.z) > F.HZ) continue;
      const t = (i + 1) / 30;
      if ((flatDist(car.pos, p) - 110) / pace <= t) { hit = p; hitTime = t; break; }
      if (i === prediction.length - 1) { hit = p; hitTime = t; }
    }

    // team-mates: let whoever is nearer take it
    const mine = flatDist(car.pos, ball.pos) + ((car.pos.z - ball.pos.z) * side > 0 ? 900 : 0);
    let support = false;
    for (const other of cars) {
      if (other === car || other.team !== car.team || other.demoed) continue;
      const theirs = flatDist(other.pos, ball.pos) + ((other.pos.z - ball.pos.z) * side > 0 ? 900 : 0);
      if (theirs + 250 < mine || (Math.abs(theirs - mine) <= 250 && other.slot < car.slot)) support = true;
    }
    if (support && !world.kickoff) {
      this.mode = 'support';
      this.target.set(clamp(ball.pos.x * 0.45, -2600, 2600), 0, clamp(ball.pos.z - side * 2700, -F.HZ + 500, F.HZ - 500));
      return;
    }

    // low on boost and the ball is a long way off: fetch some
    if (level.boost && car.boost < 12 && flatDist(car.pos, ball.pos) > 2600 && !world.kickoff && (ball.pos.z * side > -1500)) {
      let best = -1, bestD = 1700;
      for (let i = 0; i < PADS.length; i++) {
        if (world.pads[i] > 0) continue;
        const d = Math.hypot(PADS[i][0] - car.pos.x, PADS[i][1] - car.pos.z) - (PADS[i][2] ? 500 : 0);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) { this.mode = 'pad'; this.target.set(PADS[best][0], 0, PADS[best][1]); return; }
    }

    if (world.kickoff) { this.mode = 'attack'; this.target.set(0, 0, 0).addScaledVector(dir.set(0, 0, side), -60); return; }

    // where the touch should send the ball
    const danger = hit.z * side < -F.HZ * 0.4;
    if (danger) { goal.set(0, 0, -side * F.HZ); dir.subVectors(hit, goal); }             // away from our goal
    else { goal.set(clamp(hit.x * 0.3, -550, 550), 0, side * F.HZ); dir.subVectors(goal, hit); }
    dir.y = 0; dir.normalize();
    if (danger && Math.abs(dir.z) < 0.35) { dir.z = side * 0.35; dir.normalize(); }

    if (Math.random() < level.think) this.aim.set((Math.random() - 0.5) * 2 * level.error, 0, (Math.random() - 0.5) * 2 * level.error);
    const ahead = (car.pos.z - hit.z) * side;       // > 0: the car is on the wrong side of the ball
    if (ahead > 80 && !danger) {
      // get goal-side of the ball first, going round it rather than through it
      this.mode = 'behind';
      const wide = (car.pos.x >= hit.x ? 1 : -1) * 420;
      this.target.copy(hit).addScaledVector(dir, -900).add(tmp.set(wide, 0, 0));
    } else {
      this.mode = danger ? 'clear' : 'attack';
      this.target.copy(hit).addScaledVector(dir, -(BALL_R + 48)).add(this.aim);
    }
    this.target.x = clamp(this.target.x, -F.HX + 150, F.HX - 150);
    this.target.z = clamp(this.target.z, -F.HZ + 120, F.HZ - 120);
    this.target.y = 0;
  }
}
