// 程序化音效：全部 WebAudio 合成，无外部音频资产。

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.8;
    this.noiseBuf = null;
  }

  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  resume() {
    this.ensure();
    this.ctx?.resume();
  }

  noise(dur, { freq = 1200, q = 1, gain = 0.4, type = 'bandpass', when = 0, sweepTo = null, attack = 0.002 } = {}) {
    if (!this.enabled) return;
    this.ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  tone(freq, dur, { type = 'sine', gain = 0.2, when = 0, sweepTo = null } = {}) {
    if (!this.enabled) return;
    this.ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  shot(kind = 'rifle') {
    const map = {
      pistol: { f: 1600, d: 0.16, g: 0.5 },
      smg: { f: 2200, d: 0.12, g: 0.4 },
      rifle: { f: 1400, d: 0.18, g: 0.55 },
      shotgun: { f: 700, d: 0.32, g: 0.75 },
      sniper: { f: 900, d: 0.42, g: 0.85 },
      lmg: { f: 1200, d: 0.18, g: 0.5 },
      melee: { f: 2400, d: 0.09, g: 0.3 },
    };
    const s = map[kind] || map.rifle;
    this.noise(s.d, { freq: s.f, q: 0.8, gain: s.g, sweepTo: s.f * 0.25 });
    this.tone(kind === 'sniper' ? 90 : 140, 0.1, { type: 'sine', gain: 0.4, sweepTo: 45 });
  }

  reload() {
    this.noise(0.05, { freq: 2500, gain: 0.25 });
    this.tone(900, 0.04, { type: 'square', gain: 0.1, when: 0.45 });
  }

  throw() {
    this.noise(0.3, { freq: 600, q: 2, gain: 0.25, sweepTo: 200 });
  }

  explosion() {
    this.noise(0.9, { freq: 300, q: 0.5, gain: 0.9, sweepTo: 60 });
    this.tone(120, 0.8, { type: 'sine', gain: 0.8, sweepTo: 28 });
  }

  hit(headshot = false) {
    this.tone(headshot ? 1300 : 750, 0.07, { type: 'square', gain: 0.16 });
  }

  damage() {
    this.noise(0.12, { freq: 500, q: 1, gain: 0.45, sweepTo: 150 });
  }

  footstep() {
    this.noise(0.05, { freq: 700 + Math.random() * 400, q: 0.7, gain: 0.12 });
  }

  jump() {
    this.noise(0.08, { freq: 500, q: 1, gain: 0.12 });
  }

  zombie() {
    this.tone(70, 0.5, { type: 'sawtooth', gain: 0.14, sweepTo: 55 });
    this.tone(105, 0.4, { type: 'sawtooth', gain: 0.08, sweepTo: 90, when: 0.05 });
  }

  boost() {
    // 丧尸加速：低频轰鸣上扫 + 呼啸
    this.tone(55, 0.7, { type: 'sawtooth', gain: 0.16, sweepTo: 130 });
    this.noise(0.7, { freq: 600, q: 1.1, gain: 0.26, sweepTo: 2600 });
  }

  plant() {
    this.tone(660, 0.1, { type: 'square', gain: 0.12 });
    this.tone(880, 0.12, { type: 'square', gain: 0.12, when: 0.12 });
  }

  defuse() {
    this.tone(880, 0.1, { type: 'square', gain: 0.12 });
    this.tone(660, 0.12, { type: 'square', gain: 0.12, when: 0.12 });
  }

  roundStart() {
    this.tone(520, 0.15, { type: 'square', gain: 0.14 });
    this.tone(780, 0.2, { type: 'square', gain: 0.14, when: 0.18 });
  }

  roundEnd(win) {
    this.tone(win ? 700 : 330, 0.28, { type: 'square', gain: 0.14 });
    this.tone(win ? 1050 : 220, 0.35, { type: 'square', gain: 0.14, when: 0.24 });
  }

  click() {
    this.tone(1000, 0.03, { type: 'square', gain: 0.08 });
  }

  switchWeapon() {
    this.tone(700, 0.05, { type: 'square', gain: 0.09 });
    this.tone(980, 0.04, { type: 'square', gain: 0.07, when: 0.05 });
  }

  kill() {
    this.tone(880, 0.08, { type: 'square', gain: 0.13 });
    this.tone(1320, 0.12, { type: 'square', gain: 0.11, when: 0.08 });
  }

  buy() {
    this.tone(1000, 0.05, { type: 'square', gain: 0.1 });
    this.tone(1250, 0.07, { type: 'square', gain: 0.1, when: 0.06 });
  }

  pickup() {
    this.tone(900, 0.05, { type: 'triangle', gain: 0.12 });
    this.tone(1200, 0.08, { type: 'triangle', gain: 0.1, when: 0.05 });
  }

  empty() {
    this.tone(280, 0.045, { type: 'square', gain: 0.11 });
  }

  land() {
    this.noise(0.08, { freq: 420, q: 0.8, gain: 0.16, sweepTo: 110 });
  }

  tick() {
    this.tone(950, 0.04, { type: 'square', gain: 0.08 });
  }
}
