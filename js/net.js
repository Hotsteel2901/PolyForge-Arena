// 网络层（Ultra Edition）：
// 1. 完整保留 VibeHub SDK P2P 联机（rooms / quickJoin / room.join / announce）
// 2. 新增可选公网中继回退（MQTT WSS 公共中继 HiveMQ/EMQX/Mosquitto + 同设备 BroadcastChannel）
//    支持 3 种联机模式：auto（优先 VibeHub，不可用自动无缝回退公网中继）、vibehub（仅 VibeHub）、relay（直连公网中继）
// 3. 修复 net.mod() 重复 key `type` 导致自定义 Mod 消息丢失的 Bug

import { Host } from './host.js';

const RELAY_BROKERS = [
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://broker.emqx.io:8084/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];
const MQTT_CDN = 'https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js';

function randRoomId() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

function loadMqttLib() {
  if (window.mqtt) return Promise.resolve(window.mqtt);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = MQTT_CDN;
    s.async = true;
    s.onload = () => (window.mqtt ? resolve(window.mqtt) : reject(new Error('mqtt missing')));
    s.onerror = () => reject(new Error('mqtt load failed'));
    document.head.appendChild(s);
  });
}

// 轻量公网中继房间适配器：对外暴露与 VibeHub room 完全一致的接口
// (peerId, isHost, hostId, send, onMessage, onPeer, announce, close, leave)
class RelayRoomAdapter {
  constructor(roomId, peerId, isHost, client, channel) {
    this.roomId = roomId;
    this.peerId = peerId;
    this.isHost = isHost;
    this.hostId = isHost ? peerId : null;
    this.client = client;
    this.channel = channel;
    this._msgHandlers = [];
    this._peerHandlers = [];
    this.baseTopic = `polyforge/v1/${roomId}`;

    const handleIncoming = (raw) => {
      let env;
      try { env = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
      if (!env || env.from === this.peerId) return;
      if (env.to && env.to !== this.peerId) return;
      if (env.kind === 'host_hello' && !this.isHost) {
        this.hostId = env.from;
        return;
      }
      if (env.kind === 'leave') {
        for (const fn of this._peerHandlers) fn({ type: 'leave', id: env.from });
        return;
      }
      if (env.kind === 'msg' && env.data) {
        if (!this.isHost && !this.hostId && env.fromHost) this.hostId = env.from;
        for (const fn of this._msgHandlers) fn(env.data, env.from);
      }
    };

    if (this.client) {
      this.client.subscribe(`${this.baseTopic}/+`, { qos: 0 });
      this.client.on('message', (_t, payload) => handleIncoming(payload.toString()));
    }
    if (this.channel) {
      this.channel.onmessage = (e) => handleIncoming(e.data);
    }
    if (this.isHost) {
      this._beacon = setInterval(() => this._pub({ kind: 'host_hello', from: this.peerId }), 2500);
    }
  }

  _pub(env) {
    const str = JSON.stringify(env);
    if (this.client) {
      try { this.client.publish(`${this.baseTopic}/${this.peerId}`, str, { qos: 0 }); } catch { /* ignore */ }
    }
    if (this.channel) {
      try { this.channel.postMessage(env); } catch { /* ignore */ }
    }
  }

  send(data, toPeerId = null) {
    this._pub({ kind: 'msg', from: this.peerId, to: toPeerId || null, fromHost: this.isHost, data });
  }

  onMessage(fn) { this._msgHandlers.push(fn); }
  onPeer(fn) { this._peerHandlers.push(fn); }
  async announce() { return true; }
  async close() { this._pub({ kind: 'leave', from: this.peerId }); }
  leave() {
    if (this._beacon) clearInterval(this._beacon);
    this._pub({ kind: 'leave', from: this.peerId });
    try { this.client?.end(true); } catch { /* ignore */ }
    try { this.channel?.close(); } catch { /* ignore */ }
  }
}

export class Net {
  constructor() {
    this.listeners = new Map();
    this.connected = false;
    this.vibe = null;
    this.room = null;
    this.isHost = false;
    this.peerId = null;
    this.hostPeerId = null;
    this.host = null;
    this.roomId = null;
    this.offline = false;
    this.transport = 'vibehub'; // vibehub | relay | local | offline
    this.relayMode = 'auto';    // auto | vibehub | relay
    this._joinDiag = null;
    window.__joinDiag = () => this._joinDiag;
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const list = this.listeners.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  dispatch(msg) {
    for (const fn of this.listeners.get('*') || []) {
      try { fn(msg); } catch (err) { console.error('[net] wildcard handler error', err); }
    }
    for (const fn of this.listeners.get(msg.type) || []) {
      try { fn(msg); } catch (err) { console.error('[net] handler error', err); }
    }
  }

  // 公网中继回退（MQTT WSS + BroadcastChannel 同设备直连）
  async joinViaRelay({ name, mode, team, roomId, mapId, bots, botSkill }) {
    const explicit = !!roomId;
    const targetId = explicit ? String(roomId).trim().toUpperCase() : randRoomId();
    const peerId = `pf_${Math.random().toString(36).slice(2, 10)}`;
    let client = null;
    let channel = null;

    try {
      channel = new BroadcastChannel(`polyforge/v1/${targetId}`);
    } catch { /* ignore */ }

    try {
      const lib = await withTimeout(loadMqttLib(), 5000, 'mqtt cdn timeout');
      for (const url of RELAY_BROKERS) {
        try {
          client = await new Promise((resolve, reject) => {
            let done = false;
            const c = lib.connect(url, {
              clientId: `pfa_${peerId}`,
              clean: true,
              keepalive: 25,
              connectTimeout: 5500,
              reconnectPeriod: 0,
              protocolVersion: 4,
            });
            const fail = (e) => { if (!done) { done = true; try { c.end(true); } catch {} reject(e); } };
            c.on('connect', () => { if (!done) { done = true; c.options.reconnectPeriod = 4000; resolve(c); } });
            c.on('error', fail);
            c.on('close', () => fail(new Error('closed')));
            setTimeout(() => fail(new Error('timeout')), 6000);
          });
          break;
        } catch { /* try next broker */ }
      }
    } catch { /* fallback to local BroadcastChannel */ }

    if (!client && !channel) {
      throw new Error('公网中继与本地频道均不可用，请检查网络或使用离线模式');
    }

    // 显式输入房间码时先作为客端尝试 2.4 秒握手；若无房主响应则自动建房成为房主
    let isHost = !explicit;
    let room = new RelayRoomAdapter(targetId, peerId, isHost, client, channel);
    this.room = room;
    this.roomId = targetId;
    this.peerId = peerId;
    this.isHost = isHost;
    this.transport = client ? 'relay' : 'local';

    room.onMessage((msg, fromPeerId) => {
      if (!msg || typeof msg !== 'object') return;
      if (this.isHost) this.host?.handleMessage(msg, fromPeerId);
      else this.dispatch(msg);
    });
    room.onPeer((ev) => this.handlePeerEvent(ev));

    if (!isHost) {
      const welcomeP = this.waitForWelcome(2800);
      const joinMsg = { type: 'join', name, mode, team };
      room.send(joinMsg);
      const retry = setInterval(() => room.send(joinMsg), 600);
      try {
        await welcomeP;
        clearInterval(retry);
        this.hostPeerId = room.hostId;
        this.connected = true;
        return { isHost: false, roomId: targetId, transport: this.transport };
      } catch {
        clearInterval(retry);
        // 房间内暂无房主：无缝升级为该房间房主
        isHost = true;
        room.isHost = true;
        room.hostId = peerId;
        this.isHost = true;
        this.hostPeerId = peerId;
        room._beacon = setInterval(() => room._pub({ kind: 'host_hello', from: peerId }), 2500);
      }
    }

    this.connected = true;
    this.host = new Host(this);
    await this.host.init({ name, mode, team, mapId, bots, botSkill });
    return { isHost: true, roomId: targetId, transport: this.transport };
  }

  async join({ name, mode, team, roomId, mapId, quick = true, bots, botSkill, relayMode }) {
    const rMode = relayMode || this.relayMode || 'auto';
    if (rMode === 'relay') {
      return this.joinViaRelay({ name, mode, team, roomId, mapId, bots, botSkill });
    }
    if (!this.vibe) {
      if (rMode === 'auto') {
        console.warn('[net] VibeHub 不可用，自动回退至公网中继');
        return this.joinViaRelay({ name, mode, team, roomId, mapId, bots, botSkill });
      }
      throw new Error('VibeHub 未初始化');
    }

    try {
      return await this._joinViaVibeHub({ name, mode, team, roomId, mapId, quick, bots, botSkill });
    } catch (err) {
      if (rMode === 'auto') {
        console.warn('[net] VibeHub 联机失败，自动切换公网中继回退：', err?.message || err);
        return this.joinViaRelay({ name, mode, team, roomId, mapId, bots, botSkill });
      }
      throw err;
    }
  }

  async _joinViaVibeHub({ name, mode, team, roomId, mapId, quick = true, bots, botSkill }) {
    const explicit = !!roomId;
    const originalCode = explicit ? String(roomId).trim().toUpperCase() : '';
    let targetId = originalCode;
    let attempt = 0;
    let wantedHost = false;
    const maxAttempts = 2;

    this._joinDiag = { explicit, code: originalCode, precheck: null, attempt: 0 };

    if (explicit) {
      let found = false;
      let full = false;
      let checkErr = false;
      for (let i = 0; i < 4 && !found && !checkErr; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 600));
        try {
          const rooms = await this.vibe.rooms.list();
          const meta = (rooms || []).find((r) => r.roomId === targetId);
          if (meta && meta.open !== false) {
            found = true;
            full = !!meta.max && (meta.players ?? 0) >= meta.max;
          }
        } catch {
          checkErr = true;
        }
      }
      this._joinDiag.precheck = checkErr ? 'err' : found ? (full ? 'full' : 'found') : 'missing';
      if (!found && !checkErr) throw new Error('房间码无效或房间不存在，请核对房间码后重试');
      if (found && full) throw new Error('房间已满，请稍后再试或使用快速匹配');
    }

    while (attempt < maxAttempts) {
      attempt += 1;
      this._joinDiag.attempt = attempt;
      if (!targetId) {
        if (quick && attempt === 1) {
          try {
            targetId = await this.vibe.rooms.quickJoin({
              filter: (r) => !!r.open && !!r.max && r.mode === mode && (r.players ?? 0) < r.max,
            });
          } catch (err) {
            console.warn('[net] quickJoin failed, will host a new room', err);
          }
          if (!targetId) {
            try {
              await new Promise((r) => setTimeout(r, 800));
              targetId = await this.vibe.rooms.quickJoin({
                filter: (r) => !!r.open && !!r.max && r.mode === mode && (r.players ?? 0) < r.max,
              });
            } catch (err) {
              console.warn('[net] quickJoin retry failed', err);
            }
          }
        }
        if (!targetId) {
          targetId = randRoomId();
          wantedHost = true;
        }
      }

      let room;
      try {
        room = await withTimeout(this.vibe.room.join(targetId, { topology: 'host' }), 15000, '加入房间超时，请重试');
      } catch (err) {
        this._joinDiag.joinErr = (err && err.message) || '';
        if (explicit) {
          if (attempt < maxAttempts) continue;
          throw err;
        }
        targetId = '';
        continue;
      }
      this.room = room;
      this.roomId = targetId;
      this.peerId = room.peerId;
      this.isHost = !!room.isHost;
      this.hostPeerId = room.hostId;
      this.transport = 'vibehub';
      this._joinDiag.isHost = this.isHost;
      this._joinDiag.hostPeerId = this.hostPeerId;

      room.onMessage((msg, fromPeerId) => {
        if (!msg || typeof msg !== 'object') return;
        if (this.isHost) this.host?.handleMessage(msg, fromPeerId);
        else this.dispatch(msg);
      });
      room.onPeer((ev) => this.handlePeerEvent(ev));

      if (this.isHost) {
        this.connected = true;
        this.host = new Host(this);
        await this.host.init({ name, mode, team, mapId, bots, botSkill });
        return { isHost: true, roomId: targetId, transport: 'vibehub' };
      }

      if (wantedHost) {
        try { room.leave(); } catch { /* ignore */ }
        this.room = null;
        targetId = '';
        wantedHost = false;
        continue;
      }

      const welcomePromise = this.waitForWelcome(10000);
      const joinMsg = { type: 'join', name, mode, team };
      const sendJoin = () => {
        if (this.hostPeerId) this.room.send(joinMsg, this.hostPeerId);
        else this.room.send(joinMsg);
      };
      sendJoin();
      const joinRetry = setInterval(sendJoin, 700);
      welcomePromise.then(() => clearInterval(joinRetry), () => clearInterval(joinRetry));
      try {
        await welcomePromise;
        this._joinDiag.welcome = 'ok';
      } catch (err) {
        this._joinDiag.welcome = 'timeout';
        try { room.leave(); } catch { /* ignore */ }
        this.room = null;
        this.hostPeerId = null;
        if (explicit) {
          if (attempt < maxAttempts) continue;
          throw err;
        }
        targetId = '';
        continue;
      }
      this.connected = true;
      return { isHost: false, roomId: targetId, transport: 'vibehub' };
    }
    throw new Error('无法加入房间，请重试');
  }

  waitForWelcome(timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(Object.assign(new Error('等待房主响应超时（房主可能已离线）'), { code: 'WELCOME_TIMEOUT' }));
      }, timeoutMs);
      const off = this.on('welcome', (msg) => {
        clearTimeout(timer);
        off();
        resolve(msg);
      });
    });
  }

  handlePeerEvent(ev) {
    if (this.isHost) {
      this.host?.handlePeerEvent(ev);
      return;
    }
    if (this._joinDiag) {
      (this._joinDiag.peers = this._joinDiag.peers || []).push({
        type: ev.type,
        id: (ev.id || '').slice(0, 8),
        reason: ev.reason || '',
      });
      if (this._joinDiag.peers.length > 20) this._joinDiag.peers.shift();
    }
    if (ev.type === 'leave' && ev.id === this.hostPeerId) {
      this.dispatch({ type: 'net_close', reason: 'host_left' });
    } else if (ev.type === 'error') {
      console.warn('[net] peer error', ev.reason, ev.detail);
    }
  }

  send(obj) {
    if (!this.connected) return;
    if (this.isHost) {
      this.host?.handleMessage(obj, this.peerId);
    } else if (this.room) {
      if (this.hostPeerId) this.room.send(obj, this.hostPeerId);
      else this.room.send(obj);
    }
  }

  sendToPeer(peerId, obj) {
    if (this.room) this.room.send(obj, peerId);
  }

  sendInput(input) {
    this.send({ type: 'input', ...input });
  }

  chat(text) {
    this.send({ type: 'chat', text });
  }

  mod(modType, payload) {
    this.send({ type: 'mod', modType, payload });
  }

  ping() {
    this.send({ type: 'ping', t: performance.now() });
  }

  leave() {
    try {
      if (this.host?.room) this.host.room.stop();
      if (this.isHost && this.room) this.room.close?.().catch(() => {});
      this.room?.leave();
    } catch { /* ignore */ }
    this.room = null;
    this.connected = false;
    this.isHost = false;
    this.host = null;
    this.hostPeerId = null;
    this.offline = false;
  }
}
