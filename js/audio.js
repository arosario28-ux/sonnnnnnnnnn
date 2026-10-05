// All sound is synthesised with WebAudio; there are no audio files.
export const Sound = {
  ctx: null, enabled: true, master: null, engine: null, rocket: null,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    } catch (e) { this.enabled = false; }
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  setEnabled(on) { this.enabled = on; if (!on) this.drive(0, false, false); },
  tone(freq, dur, type, gainVal, glideTo) {
    if (!this.enabled || !this.ctx) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator(), g = this.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gainVal || 0.3, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  },
  noiseBuffer(dur, fade) {
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, n, this.ctx.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (fade ? 1 - i / n : 1);
    return buffer;
  },
  noiseBurst(dur, gainVal, filterFreq, type = 'bandpass') {
    if (!this.enabled || !this.ctx) return;
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(dur, true);
    const filt = this.ctx.createBiquadFilter();
    filt.type = type; filt.frequency.value = filterFreq || 1200;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainVal || 0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start(t0);
  },
  // The local car's engine note and rocket, updated every frame while playing.
  drive(speed, boosting, playing) {
    if (!this.ctx) return;
    if (!this.engine) {
      const osc = this.ctx.createOscillator(), sub = this.ctx.createOscillator();
      osc.type = 'sawtooth'; sub.type = 'square';
      const filt = this.ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 500;
      const g = this.ctx.createGain(); g.gain.value = 0;
      osc.connect(filt); sub.connect(filt); filt.connect(g); g.connect(this.master);
      osc.start(); sub.start();
      this.engine = { osc, sub, filt, g };
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer(1.5, false); src.loop = true;
      const bf = this.ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 900; bf.Q.value = 0.6;
      const bg = this.ctx.createGain(); bg.gain.value = 0;
      src.connect(bf); bf.connect(bg); bg.connect(this.master);
      src.start();
      this.rocket = { g: bg, bf };
    }
    const t = this.ctx.currentTime, on = playing && this.enabled;
    const k = Math.min(1, speed / 2300);
    this.engine.osc.frequency.setTargetAtTime(55 + k * 150, t, 0.08);
    this.engine.sub.frequency.setTargetAtTime(27 + k * 75, t, 0.08);
    this.engine.filt.frequency.setTargetAtTime(300 + k * 1300, t, 0.1);
    this.engine.g.gain.setTargetAtTime(on ? 0.035 + k * 0.035 : 0, t, 0.1);
    this.rocket.g.gain.setTargetAtTime(on && boosting ? 0.2 : 0, t, 0.04);
    this.rocket.bf.frequency.setTargetAtTime(700 + k * 900, t, 0.1);
  },
  jump() { this.tone(300, 0.12, 'square', 0.12, 620); },
  dodge() { this.tone(520, 0.16, 'square', 0.13, 240); this.noiseBurst(0.12, 0.12, 1800); },
  land() { this.noiseBurst(0.1, 0.2, 220, 'lowpass'); },
  hit(power) { const k = Math.min(1, power / 2600); this.noiseBurst(0.14, 0.18 + 0.4 * k, 500 + k * 1500); this.tone(90 + k * 160, 0.12, 'triangle', 0.2 + k * 0.25, 50); },
  bounce(speed) { const k = Math.min(1, speed / 2500); if (k > 0.04) { this.noiseBurst(0.09, 0.08 + k * 0.3, 380, 'lowpass'); this.tone(70 + k * 60, 0.1, 'sine', 0.1 + k * 0.3, 45); } },
  bump() { this.noiseBurst(0.12, 0.3, 700); },
  demo() { this.noiseBurst(0.5, 0.6, 260, 'lowpass'); this.tone(160, 0.5, 'sawtooth', 0.3, 30); },
  pad(big) { this.tone(big ? 300 : 520, big ? 0.3 : 0.14, 'square', big ? 0.16 : 0.1, big ? 1000 : 900); },
  goal() {
    this.noiseBurst(0.9, 0.7, 180, 'lowpass');
    this.tone(70, 0.9, 'sine', 0.6, 30);
    [440, 554, 659, 880].forEach((n, i) => setTimeout(() => this.tone(n, 0.4, 'sawtooth', 0.2), 120 + i * 90));
  },
  countdownBeep(final) { this.tone(final ? 880 : 520, final ? 0.4 : 0.14, 'square', 0.2); },
  click() { this.tone(700, 0.05, 'square', 0.1); },
  reelTick() { this.tone(320 + Math.random() * 70, 0.035, 'square', 0.06); },
  dropReveal(tier) {
    const sets = [[392, 440], [392, 494, 587], [440, 554, 659, 880], [349, 440, 554, 659, 880], [294, 370, 440, 587, 740, 880], [261, 330, 392, 494, 587, 740, 880, 988]];
    const notes = sets[Math.min(tier, sets.length - 1)];
    notes.forEach((n, i) => setTimeout(() => this.tone(n, 0.28 + tier * 0.03, tier >= 4 ? 'sawtooth' : 'triangle', 0.22), i * (75 - tier * 6)));
    if (tier >= 3) setTimeout(() => this.noiseBurst(0.3, 0.22, 1500), 40);
  },
};
