// 宿主控制器：在房主浏览器 tab 内运行权威模拟（state-sync）。
// 复刻原 server/index.js 的消息路由与加入流程，但“连接”被替换为：
//   - 远程玩家 → VibeHub room.send(msg, peerId)
//   - 房主本人 → 本地回环（dispatch 给自己，走与远程完全相同的协议）
// Room 广播/定向发送经 connections 里的 sendFn 统一出口，因此客户端渲染层完全无需感知传输差异。

import { Room } from '../host/room.js';
import { CONFIG } from './config.js';
import { weaponPrice } from '../shared/economy.js';

const MODE_LABEL = { defusal: '拆弹模式', zombie: '生化模式' };

export class Host {
  constructor(net) {
    this.net = net;
    this.room = null;
    this.peerToPlayer = new Map(); // VibeHub peerId -> 玩家 id
    this.lastInputAt = new Map();  // peerId -> 上次输入时间戳（节流）
  }

  async init({ name, mode, team }) {
    const m = mode === 'zombie' ? 'zombie' : 'defusal';
    const room = new Room({
      id: this.net.offline ? 'offline' : 'p2p',
      mode: m,
      mapId: m === 'defusal' ? 'vertex' : 'containment',
      maxPlayers: CONFIG.maxPlayers,
      botCount: CONFIG.bots,
      config: { mods: CONFIG.mods },
    });
    this.room = room;
    await room.start(); // 浏览器版 mods 加载 → 填 Bot → 开局/购买阶段 → 30Hz 主循环
    // 房主本人作为玩家加入（本地回环）
    this.handleJoin({ name, mode: m, team }, this.net.peerId);
    // 联机房主才上架房间供快速匹配（quickJoin 读取 open/max/mode 等元数据）。
    // 离线模式没有 VibeHub room，跳过——不 announce、不进匹配池，对主版零影响。
    if (this.net.room) {
      const announceMeta = {
        open: true,
        listed: true,
        max: CONFIG.maxPlayers,
        mode: m,
        map: room.mapId,
        modeLabel: MODE_LABEL[m],
      };
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await this.net.room.announce(announceMeta);
          break;
        } catch (err) {
          if (attempt === 2) console.warn('[host] announce failed', err);
          else await new Promise((r) => setTimeout(r, 700));
        }
      }
    }
    this.net.connected = true;
  }

  // 消息路由（复刻 server/index.js switch）
  handleMessage(msg, fromId) {
    switch (msg.type) {
      case 'join':
        this.handleJoin(msg, fromId);
        break;
      case 'input':
        this.handleInput(msg, fromId);
        break;
      case 'buy': {
        const p = this.playerFor(fromId);
        if (!p) return;
        const result = this.room.handleBuy(p, String(msg.item || ''));
        if (!result.ok) this.sendRaw(fromId, { type: 'buy_fail', item: msg.item, reason: result.reason });
        break;
      }
      case 'zselect': {
        const p = this.playerFor(fromId);
        if (!p) return;
        const result = this.room.handleZombieSelect(p, String(msg.item || ''));
        if (!result.ok) this.sendRaw(fromId, { type: 'buy_fail', item: msg.item, reason: result.reason });
        break;
      }
      case 'refund': {
        const p = this.playerFor(fromId);
        if (!p) return;
        const result = this.room.handleRefund(p, String(msg.item || ''));
        if (!result.ok) this.sendRaw(fromId, { type: 'refund_fail', item: msg.item, reason: result.reason });
        break;
      }
      case 'chat': {
        const p = this.playerFor(fromId);
        if (!p) return;
        const text = String(msg.text || '').slice(0, 120);
        if (!text.trim()) return;
        this.room.broadcast({ type: 'chat', name: p.name, text: text.slice(0, 120) });
        break;
      }
      case 'ping':
        this.sendRaw(fromId, { type: 'pong', t: msg.t ?? Date.now() });
        break;
      case 'mod': {
        const p = this.playerFor(fromId);
        if (!p) return;
        this.room.handleModMessage(p.id, {
          type: String(msg.type || '').slice(0, 40),
          payload: msg.payload ?? {},
        });
        break;
      }
      default:
        break;
    }
  }

  handleJoin(msg, fromId) {
    if (this.peerToPlayer.has(fromId)) {
      // 重复 join（客户端在连接建立前重发）：重发 welcome，确保握手完成（客户端忽略已处理的 welcome）
      const pid = this.peerToPlayer.get(fromId);
      const p = this.room?.players.get(pid);
      if (p && this.room.connections.has(pid)) {
        this.sendWelcome(p, fromId, msg.mode === 'zombie' ? 'zombie' : 'defusal');
      }
      return;
    }
    const mode = msg.mode === 'zombie' ? 'zombie' : 'defusal';
    const teamPref = msg.team === 'ct' || msg.team === 't' ? msg.team : 'random';
    const name = String(msg.name || '战士').slice(0, 16).trim() || '战士';
    const room = this.room;
    if (room.humans() >= room.maxPlayers) {
      this.sendRaw(fromId, { type: 'error', code: 'room_full', message: '房间已满' });
      return;
    }
    const p = room.addPlayer(name, teamPref);
    if (!p) {
      this.sendRaw(fromId, { type: 'error', code: 'room_full', message: '房间已满' });
      return;
    }
    p.connected = true;
    this.peerToPlayer.set(fromId, p.id);
    // 注册到 room.connections：Room.broadcast/sendTo 统一从这里取 sendFn 发送
    room.connections.set(p.id, (json) => this.sendRaw(fromId, JSON.parse(json)));
    this.sendWelcome(p, fromId, mode);
    room.broadcast({ type: 'player_joined', id: p.id, name });
    room.spawnJoiner(p);
  }

  // 下发 welcome + 选枪目录（含 Mod 注册的主武器）
  sendWelcome(p, fromId, mode) {
    this.room.sendTo(p.id, {
      type: 'welcome',
      id: p.id,
      mode,
      map: this.room.mapId,
      mapName: this.room.map.name,
      modeLabel: MODE_LABEL[mode],
      tickRate: 30,
      mods: (this.room.modResults.loaded || []).map((m) => m.id),
    });
    this.room.sendTo(p.id, {
      type: 'weapon_catalog',
      items: [...this.room.weapons.values()]
        .filter((d) => d.slot === 2)
        .map((d) => ({ id: d.id, name: d.name, cost: weaponPrice(d), def: d })),
      equipped: p.weapons.get(2)?.def.id ?? null,
    });
  }

  handleInput(msg, fromId) {
    const p = this.playerFor(fromId);
    if (!p) return;
    const now = Date.now();
    if (now - (this.lastInputAt.get(fromId) || 0) < 8) return; // 输入节流
    this.lastInputAt.set(fromId, now);
    const room = this.room;
    p.inputAt = room.time;
    const mv = Array.isArray(msg.mv) && msg.mv.length === 4 ? msg.mv.map((v) => (v ? 1 : 0)) : [0, 0, 0, 0];
    // 边沿动作合并进累加器，避免被后续输入帧在 tick 前覆盖
    if (Number.isFinite(msg.sw) && msg.sw >= 0) p.edge.sw = msg.sw;
    if (msg.swd) p.edge.swd = (p.edge.swd || 0) + (msg.swd > 0 ? 1 : -1);
    if (msg.r) p.edge.r = 1;
    if (msg.j) p.edge.j = 1;
    if (msg.skill) p.edge.skill = 1;
    p.input = {
      mv,
      j: msg.j ? 1 : 0,
      s: msg.s ? 1 : 0,
      c: msg.c ? 1 : 0,
      yaw: Number.isFinite(msg.yaw) ? msg.yaw : p.yaw,
      pitch: Number.isFinite(msg.pitch) ? Math.max(-1.55, Math.min(1.55, msg.pitch)) : p.pitch,
      fire: msg.fire ? 1 : 0,
      ads: msg.ads ? 1 : 0,
      r: 0,
      sw: -1,
      swd: 0,
      u: msg.u ? 1 : 0,
      seq: msg.seq ?? 0,
    };
    p.yaw = p.input.yaw;
    p.pitch = p.input.pitch;
  }

  handlePeerEvent(ev) {
    if (ev.type !== 'join' && ev.type !== 'leave') return;
    const pid = this.peerToPlayer.get(ev.id);
    if (!pid) return;
    if (ev.type === 'leave') {
      this.peerToPlayer.delete(ev.id);
      this.lastInputAt.delete(ev.id);
      this.room.removePlayer(pid); // 内部会删除 connections 并广播 player_left
    }
  }

  // 房主退出：房主是权威（SDK 不做权威迁移），离开后对局无法继续，因此关闭并下架房间。
  // 若房里还有其他真人（非 Bot、非房主本人），先广播系统提示告知对局结束。
  shutdown() {
    const room = this.room;
    const hostPid = this.peerToPlayer.get(this.net.peerId);
    const otherHumans = [...room.players.values()].filter((p) => !p.isBot && p.id !== hostPid);
    if (otherHumans.length > 0) {
      room.say('房主退出房间，对局结束');
    }
    room.stop(); // 停止 30Hz 模拟
    this.net.room?.close?.().catch(() => {});
    this.net.room?.leave?.();
  }

  playerFor(fromId) {
    const pid = this.peerToPlayer.get(fromId);
    return pid ? this.room.players.get(pid) : null;
  }

  sendRaw(peerId, msg) {
    if (peerId === this.net.peerId) {
      this.net.dispatch(msg); // 房主本人 → 本地回环
    } else if (this.net.room) {
      this.net.room.send(msg, peerId);
    }
  }
}
