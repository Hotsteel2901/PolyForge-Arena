// 原创 D&B 播放列表引擎：4 首曲目自动循环，淡出后无缝切入下一首。
// 实时 WebAudio 合成：鼓、Reese 贝斯、Pad、主旋律、琶音、Riser/Impact。
// 前瞻调度器按乐谱数据以 16 分音符推进，乐谱结构见 shared/dnb-song.js。
import { SONGS, midiToFreq, mulberry32, totalSteps, playlistDurationSeconds } from '../shared/dnb-song.js';

export class DnB {
  constructor(sfx, { volume = 0.42 } = {}) {
    this.sfx = sfx;
    this.volume = volume;
    this.playing = false;
    this.timer = null;
    this.endTimer = null;
    this.step = 0;
    this.nextTime = 0;
    this.events = 0;
    this.rng = mulberry32(20260801);
    this.playlist = SONGS;
    this.songIndex = 0;
    this.loadSong(this.playlist[0]);
    window.__musicNext = () => this.nextSong(true);
  }

  loadSong(song) {
    this.song = song;
    this.stepDur = 60 / song.bpm / 4;
    this.barLen = this.stepDur * 16;
    this.total = totalSteps(song);
    this.sectionStarts = [];
    let acc = 0;
    for (const s of song.sections) {
      this.sectionStarts.push(acc);
      acc += s.bars * 16;
    }
    this.melodyMap = new Map();
    for (const [id, arr] of Object.entries(song.melodies || {})) {
      const m = new Map();
      for (const [beat, midi, dur] of arr) {
        const step = Math.round(beat * 4);
        if (!m.has(step)) m.set(step, []);
        m.get(step).push({ midi, dur });
      }
      this.melodyMap.set(id, m);
    }
  }

  ensure() {
    this.sfx.ensure();
    if (this.ctx || !this.sfx.ctx) return;
    const ctx = this.sfx.ctx;
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(this.sfx.master);

    this.drumFilter = ctx.createBiquadFilter();
    this.drumFilter.type = 'lowpass';
    this.drumFilter.frequency.value = 18000;
    this.drumBus = ctx.createGain();
    this.drumBus.gain.value = 1;
    this.drumFilter.connect(this.drumBus).connect(this.gain);

    this.bassFilter = ctx.createBiquadFilter();
    this.bassFilter.type = 'lowpass';
    this.bassFilter.frequency.value = 720;
    this.bassBus = ctx.createGain();
    this.bassBus.gain.value = 1;
    this.bassFilter.connect(this.bassBus).connect(this.gain);

    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 1350;
    this.padBus = ctx.createGain();
    this.padBus.gain.value = 1;
    this.padFilter.connect(this.padBus).connect(this.gain);

    this.leadFilter = ctx.createBiquadFilter();
    this.leadFilter.type = 'lowpass';
    this.leadFilter.frequency.value = 2800;
    this.leadBus = ctx.createGain();
    this.leadBus.gain.value = 1;
    this.leadFilter.connect(this.leadBus).connect(this.gain);

    this.fxBus = ctx.createGain();
    this.fxBus.gain.value = 1;
    this.fxBus.connect(this.gain);

    this.delay = ctx.createDelay(1.5);
    this.delay.delayTime.value = 0.2617;
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.32;
    this.delayWet = ctx.createGain();
    this.delayWet.gain.value = 0.22;
    this.delay.connect(this.delayFb).connect(this.delay);
    this.delay.connect(this.delayWet).connect(this.fxBus);
  }

  start() {
    this.ensure();
    if (!this.ctx || this.playing) return;
    this.ctx.resume();
    this.playing = true;
    this.step = 0;
    this.events = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    if (this.gain) this.gain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.1);
    this.timer = setInterval(() => this.tick(), 25);
    this.debug();
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    this.timer = null;
    clearTimeout(this.endTimer);
    this.endTimer = null;
    if (this.ctx && this.gain) {
      this.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.18);
    }
    this.debug();
  }

  tick() {
    if (!this.playing) return;
    const horizon = this.ctx.currentTime + 0.28;
    while (this.nextTime < horizon && this.playing && this.step < this.total) {
      this.scheduleStep(this.step, this.nextTime);
      this.step++;
      this.nextTime += this.stepDur;
      if (this.step >= this.total) {
        this.scheduleEnd();
        break;
      }
    }
    this.debug();
  }

  sectionInfo(step) {
    let idx = 0;
    while (idx < this.sectionStarts.length - 1 && step >= this.sectionStarts[idx + 1]) idx++;
    const start = this.sectionStarts[idx];
    const s = this.song.sections[idx];
    return {
      section: s,
      idx,
      localStep: step - start,
      localBar: Math.floor((step - start) / 16),
      globalBar: Math.floor(step / 16),
    };
  }

  chordAt(globalBar) {
    return this.song.progression[globalBar % this.song.progression.length];
  }

  isDrop(section) {
    return section.id.startsWith('drop');
  }

  scheduleStep(step, t) {
    const { section, localStep, localBar, globalBar } = this.sectionInfo(step);
    const chord = this.chordAt(globalBar);
    if (localStep === 0) {
      this.events++;
      if (this.gain) this.gain.gain.setTargetAtTime(this.volume * (section.gain ?? 1), t, 0.4);
      if (section.pads) this.pad(t, this.song.chords[chord], this.barLen);
      if (section.riser) this.riser(t, this.barLen, 300, 4800, 0.13 + (localBar >= 6 ? 0.09 : 0));
      if (section.id.startsWith('breakdown') && localBar >= 6) this.riser(t, this.barLen * 2, 400, 5200, 0.14);
      if (section.drums === 'filtered') this.drumFilter.frequency.setTargetAtTime(900, t, 0.2);
      else if (section.drums === 'full' || section.drums === 'roll') this.drumFilter.frequency.setTargetAtTime(18000, t, 0.2);
      else if (section.drums === 'sparse') this.drumFilter.frequency.setTargetAtTime(6000, t, 0.2);
      if (section.id === 'outro') {
        this.drumFilter.frequency.setTargetAtTime(Math.max(2400, 15000 - localBar * 1700), t, 0.3);
        if (localBar === section.bars - 1) {
          this.impact(t);
          this.pad(t, this.song.finalChord, this.barLen * 3, 0.075);
        }
      }
      if (this.isDrop(section) && localBar === 0) this.impact(t);
    }

    const stepInBar = localStep % 16;
    const drums = section.drums;
    const fill = this.isDrop(section) && localBar === 15;

    // ---------- 鼓 ----------
    if (drums === 'filtered') {
      if (stepInBar === 0 || stepInBar === 8) this.kick(t, 0.85);
      if ([2, 6, 10, 14].includes(stepInBar)) this.shaker(t, 0.1 + this.rng() * 0.03);
      if (stepInBar % 2 === 1) this.hat(t, 0.16);
      if (stepInBar === 14) this.hat(t, 0.2, true);
    } else if (drums === 'full') {
      if (fill) {
        this.snare(t, 0.09 + stepInBar * 0.045);
        if (stepInBar === 0) this.kick(t, 1);
        if (stepInBar === 14) this.hat(t, 0.3, true);
        if (stepInBar === 15) this.crash(t, 0.7);
      } else {
        if ([0, 4, 8, 12].includes(stepInBar)) this.kick(t, 1);
        if (stepInBar === 4 || stepInBar === 12) this.snare(t, 0.72);
        if (localBar % 2 === 1 && (stepInBar === 10 || stepInBar === 14)) this.snare(t, 0.14);
        this.hat(t, stepInBar % 2 === 0 ? 0.2 : 0.13);
        if (stepInBar === 14) this.hat(t, 0.26, true);
        if (localBar >= 8 && (stepInBar === 4 || stepInBar === 12)) this.clap(t, 0.2);
      }
    } else if (drums === 'sparse') {
      if (stepInBar === 0 || stepInBar === 8) this.kick(t, 0.85);
      if (stepInBar === 4 || stepInBar === 12) this.snare(t, 0.32);
      if ([2, 6, 10, 14].includes(stepInBar)) this.hat(t, 0.1);
      if (stepInBar === 14) this.hat(t, 0.26, true);
    } else if (drums === 'roll') {
      if ([0, 4, 8, 12].includes(stepInBar)) this.kick(t, 1);
      if (localBar >= 6) {
        this.snare(t, 0.1 + stepInBar * 0.05);
      } else {
        if (stepInBar === 4 || stepInBar === 12) this.snare(t, 0.6);
        if (localBar % 2 === 1 && (stepInBar === 10 || stepInBar === 14)) this.snare(t, 0.13);
        this.hat(t, 0.17);
        if (stepInBar === 14) this.hat(t, 0.25, true);
      }
    } else if (drums === 'fade') {
      const fade = 1 - localBar * 0.09;
      if (stepInBar === 0 || stepInBar === 8) this.kick(t, 0.85 * Math.max(0.3, fade));
      if (stepInBar === 4 || stepInBar === 12) this.snare(t, 0.5 * Math.max(0.2, fade));
      if ([2, 6, 10, 14].includes(stepInBar)) this.hat(t, 0.13 * Math.max(0.15, fade));
    }

    // ---------- 贝斯 ----------
    if (section.bass && !fill) {
      const base = section.bassPat || 'A';
      const patKey = localBar % 2 ? `${base}2` : base;
      const pattern = this.song.bassPatterns[patKey] || this.song.bassPatterns[base];
      for (const [s, oct, dur] of pattern) {
        if (s === stepInBar) {
          const root = this.song.bassRoots[chord];
          this.bass(t, root + oct * 12, dur * this.stepDur);
        }
      }
    }

    // ---------- 主旋律 / 琶音 ----------
    if (section.lead && !fill) {
      const notes = this.melodyMap.get(section.id)?.get(localStep);
      if (notes) {
        for (const { midi, dur } of notes) {
          this.lead(t, midi, dur * this.stepDur * 4);
        }
      }
    }
    if (section.arp) {
      const k = Math.floor(localStep / 2 + localBar * 2) % this.song.arpSteps.length;
      const [idx, oct] = this.song.arpSteps[k];
      if (localStep % 2 === 0) this.arp(t, this.song.chords[chord][idx] + oct * 12, this.stepDur * 3);
    }
  }

  scheduleEnd() {
    if (this.ctx && this.gain) {
      this.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime + 0.05, 1.2);
    }
    clearTimeout(this.endTimer);
    this.endTimer = setTimeout(() => {
      if (this.playing) this.nextSong();
    }, 2200);
    if (this.endTimer.unref) this.endTimer.unref();
  }

  nextSong(immediate = false) {
    if (!this.playing) return;
    clearTimeout(this.endTimer);
    this.endTimer = null;
    this.songIndex = (this.songIndex + 1) % this.playlist.length;
    this.loadSong(this.playlist[this.songIndex]);
    this.step = 0;
    this.events = 0;
    this.nextTime = this.ctx.currentTime + (immediate ? 0.12 : 0.35);
    if (this.gain) {
      this.gain.gain.setTargetAtTime(this.volume, this.nextTime, immediate ? 0.35 : 0.9);
    }
    this.debug();
  }

  debug() {
    const info = this.sectionInfo(Math.min(this.step, this.total - 1));
    window.__music = {
      playing: this.playing,
      song: this.song.title,
      songId: this.song.id,
      songIndex: this.songIndex,
      totalSongs: this.playlist.length,
      duration: +(this.total * this.stepDur).toFixed(1),
      playlistSeconds: +playlistDurationSeconds(this.playlist).toFixed(1),
      section: info.section.id,
      bar: info.globalBar,
      totalBars: this.total / 16,
      step: this.step,
      totalSteps: this.total,
      events: this.events,
      gain: this.gain ? +this.gain.gain.value.toFixed(3) : 0,
    };
  }

  // ---------- 合成器 ----------
  noise(t, dur, filter, type, freq, q, gain, attack = 0.002) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.sfx.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(filter);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  osc(t, type, freq, dur, gain, filter, { detune = 0, attack = 0.004, release = 0.08, freqEnd = null } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.setValueAtTime(gain, t + Math.max(attack, dur * 0.7));
    g.gain.exponentialRampToValueAtTime(0.001, t + dur + release);
    o.connect(g).connect(filter);
    o.start(t);
    o.stop(t + dur + release + 0.05);
  }

  kick(t, vel = 1) {
    this.events++;
    this.osc(t, 'sine', 155, 0.14, 0.95 * vel, this.drumFilter, { freqEnd: 40 });
  }

  snare(t, vel = 0.5) {
    this.events++;
    this.noise(t, 0.13, this.drumFilter, 'bandpass', 1900, 0.9, 0.55 * vel);
    this.osc(t, 'triangle', 185, 0.06, 0.22 * vel, this.drumFilter, { freqEnd: 140 });
  }

  hat(t, vel = 0.2, open = false) {
    this.events++;
    this.noise(t, open ? 0.18 : 0.035, this.drumFilter, 'highpass', 7800, 0.7, vel * 0.38);
  }

  clap(t, vel = 0.2) {
    this.events++;
    this.noise(t, 0.16, this.drumFilter, 'bandpass', 1300, 1.2, vel * 0.7);
    this.osc(t, 'sine', 230, 0.08, vel * 0.2, this.drumFilter, { freqEnd: 180 });
  }

  shaker(t, vel = 0.1) {
    this.events++;
    this.noise(t, 0.045, this.drumFilter, 'highpass', 9000, 0.8, vel);
  }

  crash(t, vel = 0.7) {
    this.events++;
    this.noise(t, 1.1, this.fxBus, 'highpass', 4200, 0.6, vel * 0.5);
  }

  riser(t, dur, from, to, gain) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.sfx.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.1;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur * 0.95);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.fxBus);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  impact(t) {
    this.events++;
    this.osc(t, 'sine', 120, 0.55, 0.85, this.fxBus, { freqEnd: 32 });
    this.crash(t, 1);
    this.noise(t, 0.28, this.fxBus, 'lowpass', 320, 0.7, 0.55);
  }

  pad(t, midis, dur, gain = 0.05) {
    for (let i = 0; i < midis.length; i++) {
      const freq = midiToFreq(midis[i]);
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = i % 2 === 0 ? -0.34 : 0.34;
      panner.connect(this.padFilter);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + dur * 0.32);
      g.gain.setValueAtTime(gain, t + dur * 0.75);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur + 1.3);
      g.connect(panner);
      for (const det of [-7, 7]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = freq;
        o.detune.value = det;
        o.connect(g);
        o.start(t);
        o.stop(t + dur + 1.5);
      }
      const sub = this.ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = freq / 2;
      sub.connect(g);
      sub.start(t);
      sub.stop(t + dur + 1.5);
      this.events++;
    }
  }

  bass(t, midi, dur, gain = 0.16) {
    const freq = midiToFreq(midi);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.setValueAtTime(gain, t + Math.max(0.006, dur * 0.75));
    g.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.04);
    g.connect(this.bassFilter);
    for (const det of [-12, 12]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = freq / 2;
    sub.connect(g);
    sub.start(t);
    sub.stop(t + dur + 0.1);
    this.events++;
  }

  lead(t, midi, dur, gain = 0.17) {
    const freq = midiToFreq(midi);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.setValueAtTime(gain, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, t + Math.max(0.14, dur));
    g.connect(this.leadFilter);
    const o1 = this.ctx.createOscillator();
    o1.type = 'square';
    o1.frequency.value = freq;
    o1.connect(g);
    const o2 = this.ctx.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.value = freq;
    o2.detune.value = 6;
    o2.connect(g);
    o1.start(t); o2.start(t);
    o1.stop(t + dur + 0.2); o2.stop(t + dur + 0.2);
    // 延迟回声
    const send = this.ctx.createGain();
    send.gain.value = 0.5;
    g.connect(send).connect(this.delay);
    this.events++;
  }

  arp(t, midi, dur, gain = 0.085) {
    const freq = midiToFreq(midi);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + Math.max(0.1, dur));
    g.connect(this.leadFilter);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.12);
    const send = this.ctx.createGain();
    send.gain.value = 0.35;
    g.connect(send).connect(this.delay);
    this.events++;
  }
}
