// 程序化音效：全部 WebAudio 合成，无外部音频资产。
//
// 混音拓扑：source → [低通(远距离闷音)] → gain(距离衰减) → StereoPanner(方位) → master → 压缩器 → 输出
// 所有音效都接受可选 pos 参数；带 pos 时自动做距离衰减 + 左右声像，
// 让"背后开火"和"远处交火"能靠耳朵分辨——这是 FPS 里最关键的听觉信息。

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.comp = null;
    this.enabled = true;
    this.volume = 0.8;
    this.noiseBuf = null;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.ambient = null;
    this._gates = new Map();
  }

  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    // 压缩器：多人交火时同时有十几路枪声/爆炸，不加限幅会直接削波失真
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 22;
    this.comp.ratio.value = 7;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.22;
    this.comp.connect(this.ctx.destination);
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.comp);
    const len = Math.floor(this.ctx.sampleRate * 2);
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

  // 每帧由主循环调用：记录听者位置与朝向（相机）
  updateListener(camera) {
    if (!camera) return;
    this.listener.x = camera.position.x;
    this.listener.y = camera.position.y;
    this.listener.z = camera.position.z;
    this.listener.yaw = camera.rotation.y;
  }

  // 距离衰减 + 左右声像。近场几乎不衰减，远场按 1/(d/14)^1.5 收敛，
  // 保证 40m 外的交火仍可听见但明显"远"。
  space(pos) {
    if (!pos) return { gain: 1, pan: 0, dist: 0 };
    const dx = pos.x - this.listener.x;
    const dy = (pos.y ?? this.listener.y) - this.listener.y;
    const dz = pos.z - this.listener.z;
    const dist = Math.hypot(dx, dy, dz);
    const gain = 1 / (1 + Math.pow(dist / 14, 1.5));
    const yaw = this.listener.yaw;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const pan = dist > 0.05 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / dist)) * 0.85 : 0;
    return { gain, pan, dist };
  }

  // 把增益节点接到 master：有方位时插一级 StereoPanner，远距离再插低通做空气吸收
  _output(node, sp) {
    const ctx = this.ctx;
    let tail = node;
    if (sp.dist > 6) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.max(700, 16000 - sp.dist * 260);
      tail.connect(lp);
      tail = lp;
    }
    if (sp.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = sp.pan;
      tail.connect(p);
      tail = p;
    }
    tail.connect(this.master);
  }

  // 同类音效节流：避免一帧内 8 个 bot 同时开火把音频线程打满
  _gate(key, ms) {
    const now = performance.now();
    const last = this._gates.get(key) || 0;
    if (now - last < ms) return false;
    this._gates.set(key, now);
    return true;
  }

  noise(dur, { freq = 1200, q = 1, gain = 0.4, type = 'bandpass', when = 0, sweepTo = null, attack = 0.002, pos = null } = {}) {
    if (!this.enabled) return;
    this.ensure();
    if (!this.ctx) return;
    const sp = this.space(pos);
    if (gain * sp.gain < 0.004) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.92 + Math.random() * 0.16;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain * sp.gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g);
    this._output(g, sp);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  tone(freq, dur, { type = 'sine', gain = 0.2, when = 0, sweepTo = null, pos = null, attack = 0.008 } = {}) {
    if (!this.enabled) return;
    this.ensure();
    if (!this.ctx) return;
    const sp = this.space(pos);
    if (gain * sp.gain < 0.004) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain * sp.gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    this._output(g, sp);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ---------------- 武器 ----------------
  // pos 传入他人开火位置时会自动做声像与衰减；本地开火不传。
  shot(kind = 'rifle', pos = null) {
    const map = {
      pistol: { f: 1600, d: 0.16, g: 0.5, body: 150 },
      smg: { f: 2200, d: 0.12, g: 0.4, body: 165 },
      rifle: { f: 1400, d: 0.18, g: 0.55, body: 140 },
      shotgun: { f: 700, d: 0.32, g: 0.75, body: 105 },
      sniper: { f: 900, d: 0.42, g: 0.85, body: 90 },
      lmg: { f: 1200, d: 0.18, g: 0.5, body: 128 },
      melee: { f: 2400, d: 0.09, g: 0.3, body: 0 },
      energy: { f: 2600, d: 0.14, g: 0.42, body: 220 },
      cryo: { f: 3200, d: 0.2, g: 0.4, body: 260 },
      rail: { f: 1100, d: 0.5, g: 0.7, body: 70 },
    };
    const s = map[kind] || map.rifle;
    if (!pos && !this._gate('shot:' + kind, 12)) return;
    this.noise(s.d, { freq: s.f, q: 0.8, gain: s.g, sweepTo: s.f * 0.25, pos });
    if (s.body) this.tone(s.body, s.d * 0.9, { type: 'sine', gain: 0.42, sweepTo: s.body * 0.45, pos });
    // 尾音：室外枪声的余响，让远距离交火更有空间感
    if (pos) this.noise(s.d * 2.2, { freq: 900, q: 0.6, gain: 0.12, type: 'lowpass', when: s.d * 0.4, sweepTo: 300, pos });
  }

  // 弹丸从耳边掠过：高频短促呼啸，左右声像随掠过来向
  whiz(pos) {
    if (!this._gate('whiz', 70)) return;
    this.tone(2600, 0.1, { type: 'sawtooth', gain: 0.1, sweepTo: 700, pos, attack: 0.004 });
    this.noise(0.08, { freq: 3600, q: 3, gain: 0.1, sweepTo: 1400, pos });
  }

  // 换弹：按武器换弹时长分三段（退匣 / 上匣 / 拉栓），与动画同相位
  reload(kind = 'rifle', dur = 1.8) {
    const heavy = kind === 'lmg' || kind === 'shotgun' || kind === 'sniper';
    const d = Math.max(0.6, dur);
    this.noise(0.05, { freq: 2400, gain: 0.22 });
    this.tone(heavy ? 520 : 720, 0.05, { type: 'square', gain: 0.09, when: 0.14 });
    this.noise(0.07, { freq: 1500, gain: 0.26, when: d * 0.55, attack: 0.004 });
    this.tone(heavy ? 380 : 560, 0.06, { type: 'square', gain: 0.1, when: d * 0.58 });
    this.noise(0.05, { freq: 2800, gain: 0.2, when: d * 0.86 });
    this.tone(880, 0.04, { type: 'square', gain: 0.07, when: d * 0.88 });
  }

  throw(pos = null) {
    this.noise(0.3, { freq: 600, q: 2, gain: 0.25, sweepTo: 200, pos });
  }

  bounce(pos = null) {
    if (!this._gate('bounce', 60)) return;
    this.tone(320, 0.07, { type: 'triangle', gain: 0.1, sweepTo: 180, pos });
  }

  explosion(pos = null) {
    this.noise(0.9, { freq: 300, q: 0.5, gain: 0.9, sweepTo: 60, pos });
    this.tone(120, 0.8, { type: 'sine', gain: 0.8, sweepTo: 28, pos });
    this.noise(1.6, { freq: 180, q: 0.4, gain: 0.25, type: 'lowpass', when: 0.1, sweepTo: 60, pos });
  }

  // ---------------- 反馈 ----------------
  hit(headshot = false) {
    if (headshot) {
      this.tone(1500, 0.06, { type: 'square', gain: 0.15 });
      this.tone(2200, 0.1, { type: 'sine', gain: 0.1, when: 0.03 });
    } else {
      this.tone(760, 0.06, { type: 'square', gain: 0.14 });
    }
  }

  ding() {
    this.tone(1760, 0.22, { type: 'sine', gain: 0.16 });
    this.tone(2640, 0.18, { type: 'sine', gain: 0.07, when: 0.01 });
  }

  damage() {
    this.noise(0.12, { freq: 500, q: 1, gain: 0.45, sweepTo: 150 });
    this.tone(180, 0.16, { type: 'triangle', gain: 0.16, sweepTo: 90 });
  }

  footstep(pos = null, sprint = false) {
    this.noise(0.05, { freq: 620 + Math.random() * 420, q: 0.7, gain: sprint ? 0.16 : 0.11, pos });
  }

  jump() {
    this.noise(0.08, { freq: 500, q: 1, gain: 0.12 });
  }

  land() {
    this.noise(0.08, { freq: 420, q: 0.8, gain: 0.16, sweepTo: 110 });
    this.tone(90, 0.1, { type: 'sine', gain: 0.12, sweepTo: 55 });
  }

  zombie(pos = null) {
    if (pos && !this._gate('zombie', 400)) return;
    this.tone(70, 0.5, { type: 'sawtooth', gain: 0.14, sweepTo: 55, pos });
    this.tone(105, 0.4, { type: 'sawtooth', gain: 0.08, sweepTo: 90, when: 0.05, pos });
    this.noise(0.35, { freq: 380, q: 1.6, gain: 0.06, when: 0.04, pos });
  }

  boost(pos = null) {
    this.tone(55, 0.7, { type: 'sawtooth', gain: 0.16, sweepTo: 130, pos });
    this.noise(0.7, { freq: 600, q: 1.1, gain: 0.26, sweepTo: 2600, pos });
  }

  plant() {
    this.tone(660, 0.1, { type: 'square', gain: 0.12 });
    this.tone(880, 0.12, { type: 'square', gain: 0.12, when: 0.12 });
    this.tone(1100, 0.2, { type: 'square', gain: 0.1, when: 0.26 });
  }

  defuse() {
    this.tone(880, 0.1, { type: 'square', gain: 0.12 });
    this.tone(660, 0.12, { type: 'square', gain: 0.12, when: 0.12 });
    this.tone(440, 0.2, { type: 'square', gain: 0.1, when: 0.26 });
  }

  roundStart() {
    this.tone(520, 0.15, { type: 'square', gain: 0.14 });
    this.tone(780, 0.2, { type: 'square', gain: 0.14, when: 0.18 });
  }

  roundEnd(win) {
    if (win) {
      [660, 880, 1320].forEach((f, i) => this.tone(f, 0.3, { type: 'square', gain: 0.13, when: i * 0.11 }));
    } else {
      [440, 370, 294].forEach((f, i) => this.tone(f, 0.34, { type: 'triangle', gain: 0.13, when: i * 0.13 }));
    }
  }

  click() {
    this.tone(1000, 0.03, { type: 'square', gain: 0.08 });
  }

  switchWeapon() {
    this.noise(0.04, { freq: 2000, gain: 0.14 });
    this.tone(700, 0.05, { type: 'square', gain: 0.09 });
    this.tone(980, 0.04, { type: 'square', gain: 0.07, when: 0.06 });
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
    this.noise(0.03, { freq: 3200, gain: 0.06 });
  }

  tick() {
    this.tone(950, 0.04, { type: 'square', gain: 0.08 });
  }

  // ---------------- 环境底噪 ----------------
  // outdoor：风声 + 远处低频嗡鸣；indoor：空调/机械低频；industrial：更沉的机械轰鸣
  startAmbient(kind = 'outdoor') {
    this.ensure();
    if (!this.ctx) return;
    this.stopAmbient();
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = kind === 'outdoor' ? 620 : kind === 'industrial' ? 380 : 460;
    lp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(lp).connect(g).connect(this.master);
    src.start();
    const target = kind === 'indoor' ? 0.045 : kind === 'industrial' ? 0.05 : 0.035;
    g.gain.linearRampToValueAtTime(target, ctx.currentTime + 1.8);
    // 缓慢起伏：让底噪不像一条死线
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.06 + Math.random() * 0.05;
    const lg = ctx.createGain();
    lg.gain.value = target * 0.42;
    lfo.connect(lg).connect(g.gain);
    lfo.start();
    if (kind !== 'outdoor') {
      const hum = ctx.createOscillator();
      hum.type = 'sine';
      hum.frequency.value = kind === 'industrial' ? 52 : 88;
      const hg = ctx.createGain();
      hg.gain.value = 0.012;
      hum.connect(hg).connect(g);
      hum.start();
      this.ambient = { src, g, lfo, hum };
    } else {
      this.ambient = { src, g, lfo };
    }
  }

  stopAmbient() {
    const a = this.ambient;
    this.ambient = null;
    if (!a || !this.ctx) return;
    const t = this.ctx.currentTime;
    try {
      a.g.gain.cancelScheduledValues(t);
      a.g.gain.linearRampToValueAtTime(0, t + 0.35);
      a.src.stop(t + 0.4);
      a.lfo.stop(t + 0.4);
      a.hum?.stop(t + 0.4);
    } catch {
      // 已停止
    }
  }
}
