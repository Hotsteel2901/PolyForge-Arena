// 网络层：VibeHub SDK P2P 传输适配器 + 事件分发。
// 替换原 WebSocket 封装，保持 on/off/dispatch/send/sendInput/chat/mod/ping 接口不变。
//
// 同步模型：state-sync（房主权威）。房主（isHost）在本 tab 内运行权威模拟并广播快照；
// 其他玩家把输入/命令单发房主，收到快照后本地预测 + 插值渲染。

import { Host } from './host.js';

function randRoomId() {
  // 6 位简短房间码，去掉易混淆字符（I/L/O/0/1），便于口述与输入
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// 给任意 Promise 加超时：超时先 reject，但避免未决 Promise 造成泄漏（结果仍在，只是没人等）。
function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
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
      try {
        fn(msg);
      } catch (err) {
        console.error('[net] wildcard handler error', err);
      }
    }
    for (const fn of this.listeners.get(msg.type) || []) {
      try {
        fn(msg);
      } catch (err) {
        console.error('[net] handler error', err);
      }
    }
  }

  // 加入/创建 VibeHub 房间。quick 时优先快速匹配同模式空闲房间，找不到则自己建房成为房主。
  // roomId 提供时直接加入指定房间（分享房间码）；若该房间不存在则创建并成为房主。
  // 防卡死：非房主在等待 welcome 时设超时（房主刷新后残留的“陈旧房主”房间会让 welcome
  // 永远不来，导致转圈卡死）；自动建房场景超时后换全新房间重试一次。
  async join({ name, mode, team, roomId, quick = true }) {
    if (!this.vibe) throw new Error('VibeHub 未初始化');
    const explicit = !!roomId;
    const originalCode = explicit ? String(roomId).trim().toUpperCase() : '';
    let targetId = originalCode;
    let attempt = 0;
    let wantedHost = false; // 自建房间期望自己是房主（随机码撞上已存在房间时需换码）
    const maxAttempts = 2; // 显式房间码与自动建房都允许整体重试一次

    // 加入诊断：失败后可在控制台 window.__joinDiag() 查看
    this._joinDiag = { explicit, code: originalCode, precheck: null, attempt: 0 };

    // 显式房间码：先确认房间真实存在且未关闭/未满，避免把拼错或失效的房间码
    // 误当成“新房间”自建（这正是“房间码连不上、却开进一个空房间”的现象）。
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
            // 房主刚建房的 announce 可能尚未生效：短暂等待后重试一次，避免误开新房间
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
          wantedHost = true; // 随机生成房间码，期望成为房主
        }
      }

      let room;
      try {
        room = await withTimeout(this.vibe.room.join(targetId, { topology: 'host' }), 15000, '加入房间超时，请重试');
      } catch (err) {
        this._joinDiag.joinErr = (err && err.message) || '';
        if (explicit) {
          // 确认存在的房间加入失败：可能是连接建立慢，整体重试一次
          if (attempt < maxAttempts) continue;
          throw err;
        }
        targetId = ''; // join 失败且非显式：换新房间重试
        continue;
      }
      this.room = room;
      this.roomId = targetId;
      this.peerId = room.peerId;
      this.isHost = !!room.isHost;
      this.hostPeerId = room.hostId;
      this._joinDiag.isHost = this.isHost;
      this._joinDiag.hostPeerId = this.hostPeerId;

      room.onMessage((msg, fromPeerId) => {
        if (!msg || typeof msg !== 'object') return;
        if (this.isHost) {
          this.host?.handleMessage(msg, fromPeerId);
        } else {
          this.dispatch(msg);
        }
      });
      room.onPeer((ev) => this.handlePeerEvent(ev));

      if (this.isHost) {
        this.connected = true;
        this.host = new Host(this);
        await this.host.init({ name, mode, team });
        return { isHost: true, roomId: targetId };
      }

      // 本意自建房间却成了非房主 → 随机码撞上已存在房间，立即换码重试，避免串房
      if (wantedHost) {
        try { room.leave(); } catch { /* ignore */ }
        this.room = null;
        targetId = '';
        wantedHost = false;
        continue;
      }

      // 非房主：先挂 welcome 监听（welcome 由 join 消息触发，必须提前注册），再发加入意图；
      // 注意：vibe.room.join() 刚返回时 P2P/中继连接可能尚未建立，首条 join 会被丢弃，
      // 导致房主收不到、welcome 永不返回。因此在等待 welcome 期间周期性重发（房主会忽略重复 join）。
      const welcomePromise = this.waitForWelcome(10000);
      const joinMsg = { type: 'join', name, mode, team };
      const sendJoin = () => {
        if (this.hostPeerId) this.room.send(joinMsg, this.hostPeerId);
        else this.room.send(joinMsg);
      };
      sendJoin();
      const joinRetry = setInterval(sendJoin, 700);
      welcomePromise.then(
        () => clearInterval(joinRetry),
        () => clearInterval(joinRetry)
      );
      try {
        await welcomePromise;
        this._joinDiag.welcome = 'ok';
      } catch (err) {
        this._joinDiag.welcome = 'timeout';
        try { room.leave(); } catch { /* ignore */ }
        this.room = null;
        this.hostPeerId = null;
        if (explicit) {
          // 已确认存在的房间仍握手失败：整个流程再试一次（可能是连接建立慢）
          if (attempt < maxAttempts) continue;
          throw err;
        }
        targetId = ''; // 自动建房：换全新房间重试，避开残留的陈旧房主
        continue;
      }
      this.connected = true;
      return { isHost: false, roomId: targetId };
    }
    throw new Error('无法加入房间，请重试');
  }

  // 等待房主 welcome；超时自动移除监听并拒绝。
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

  // 本端发送：房主走本地回环，其余玩家单发房主 peer（未知房主 peer 时广播兜底）。
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

  mod(type, payload) {
    this.send({ type: 'mod', type, payload });
  }

  ping() {
    this.send({ type: 'ping', t: performance.now() });
  }

  leave() {
    try {
      if (this.host?.room) this.host.room.stop(); // 停止房主 30Hz 模拟
      // 房主离开时关闭并下架房间：避免残留“陈旧房主”房间让刷新后重进同一房间卡死
      if (this.isHost && this.room) this.room.close?.().catch(() => {});
      this.room?.leave();
    } catch {
      // ignore
    }
    this.room = null;
    this.connected = false;
    this.isHost = false;
    this.host = null;
    this.hostPeerId = null;
  }
}
