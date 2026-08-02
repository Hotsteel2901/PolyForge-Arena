/*!
 * VibeHub 游戏 SDK — 账号 / 云存档 / 联机（WebRTC P2P + VibeNet 自适应中继）
 * 无依赖，全局挂载 window.VibeHub。
 *
 *   // work 是项目 slug（来自 vibeapps 试玩路径 / vibehub list），不是主站 /works/ 的作品 ID。
 *   const vibe = await VibeHub.init({ work: 'my-game' });
 *   const user = await vibe.login();                     // 弹窗授权，返回 {id,name,image}
 *   const offAuth = vibe.onAuthChange((user) => {});     // 返回取消监听函数
 *   // 用户主动退出时调用 vibe.logout();                  // 不退出 VibeHub 主站
 *   await vibe.save.set('progress', { level: 3 });
 *   const room = await vibe.room.join('room1');          // 默认 host 拓扑, relay 自动开启
 *   room.onMessage((msg, fromId) => ...);  room.send(data);
 *   room.peers();  // [{id, open, latency, relay, score}]
 *
 * VibeNet 中继: 一个主路径 + 最多一个暖备 + 切换期短暂双发。
 * - SDK 初始化即尽力贡献全局节点；登录、退出和 Room 生命周期不改变贡献状态
 * - 主线程运行, 探测用 requestIdleCallback 分片 (不阻塞游戏循环)
 * - 断线自动提升暖备，恢复后经短暂双发切回直连
 * - 重连指数退避: 1s → 2s → 4s → ... → 60s max
 */
(function (global) {
  "use strict";

  function detectReleaseChannel() {
    var script = global.document && global.document.currentScript;
    var source = script && script.src ? script.src : "";
    if (/\/sdk\/beta\//.test(source)) return "beta";
    if (/\/sdk\/v\d+\//.test(source)) return "stable";
    return "unknown";
  }

  var STUN_HOST = (function () {
    var h = global.location && global.location.hostname;
    if (h === "localhost" || h === "127.0.0.1") return "localhost";
    return "vibe.lumigrav.space";
  })();
  var ICE_SERVERS = [
    { urls: ["stun:stun.l.google.com:19302"] },
    { urls: ["stun:stun.cloudflare.com:3478"] },
    { urls: ["stun:" + STUN_HOST + ":3478"] },
  ];
  var RECEIVE_WINDOW_SIZE = 512;
  var ICE_DISCONNECT_MS = 5000;

  // VibeRelay 有限主备参数
  var RELAY_CANDIDATE_COUNT = 4;
  var RELAY_PATH_LIMIT = 2;
  var RELAY_PENDING_MS = 10000;
  var RELAY_SWITCH_OVERLAP_MS = 3000;
  var RELAY_PROBE_MS = 10000;
  var RELAY_PRUNE_SCORE = 0.10;
  var RELAY_MAX_CONSEC_FAILS = 3;
  var RELAY_COOLDOWN_MS = 120000;     // 冷却 2min 后可复活
  var RELAY_RESURRECT_SCORE = 0.35;

  // 重连指数退避
  var RECONNECT_BASE_MS = 1000;
  var RECONNECT_MAX_MS = 60000;
  var RECONNECT_GRACE_MS = 120000;    // 2min 宽限期

  // 信令轮询
  var SIGNAL_POLL_FAST_COUNT = 5;     // 前 N 次用快速间隔
  var SIGNAL_POLL_FAST_MS = 100;      // 快速轮询间隔
  var SIGNAL_POLL_NORMAL_MS = 300;    // 正常轮询间隔

  // 心跳
  var PRESENCE_HB_MS = 20000;         // presence 心跳间隔
  var ROOM_ANNOUNCE_HB_MS = 25000;    // 房间 announce 续期间隔

  // 评分引擎
  var SCORE_LAT_MAX = 500;            // 延迟评分上限 (ms), 超此值 latencyScore=0
  var SCORE_EMA_ALPHA = 0.2;          // 延迟 EMA 平滑系数
  var SCORE_FAIL_PENALTY = 0.5;       // 失败惩罚系数 (乘以当前分)
  var SCORE_LOSSRATE_DECAY = 0.02;    // 成功时丢包率衰减量
  var SCORE_LOSSRATE_RISE = 1.5;      // 失败时丢包率增长因子
  var SCORE_RECALC_WEIGHT = 0.7;      // 重算时的旧分权重
  var SCORE_MAX_STABLE = 0.85;        // 稳定 relay 分数上限 (boost 到此后不再加)

  // 探测
  var PROBE_ACK_TIMEOUT_MS = 3000;    // 探测 ACK 超时
  var PROBE_PAYLOAD = new Uint8Array([1]);   // 探测包 payload
  var WIRE_FLAG = 1;
  var WIRE_ENVELOPE_FLAG = 32;
  var WIRE_ENCRYPTED_FLAG = 64;

  // 评分 / 分数常量
  var RELAY_PRUNE_GRACE_MS = 90000;    // 新 relay 保护期 (1.5min 内不因低分被剪枝)
  var SCORE_PICK_MIN = 0.08;           // pickTop 最低分数阈值
  var SCORE_INIT = 0.5;                // 新 relay 初始分
  var SCORE_INIT_LATENCY = 100;        // 新 relay 初始延迟估算 (ms)
  var SCORE_RESURRECT_LATENCY = 200;   // 复活 relay 初始延迟估算 (ms)
  var SCORE_RESURRECT_LOSS = 0.15;     // 复活 relay 的保守初始丢包率
  var SCORE_INIT_LOSS = 0.05;          // 新 relay 初始丢包率
  var SCORE_RECALC_LAT_WEIGHT = 0.2;   // _recalc 延迟评分权重
  var SCORE_RECALC_LOSS_WEIGHT = 0.1;   // _recalc 丢包评分权重
  var SCORE_MIN_FLOOR = 0.01;           // 分数最小值 (避免降至 0)
  var SCORE_LOSSRATE_FAIL_FLOOR = 0.03; // reportFail: 丢包率增长的绝对加数
  var STREAM_PROBE = 0;
  var STREAM_GAME = 1;

  function randomId() {
    return "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
  function defaultApiBase() {
    var h = global.location.hostname;
    if (h === "localhost" || h === "127.0.0.1") return global.location.origin;
    return "https://vibe.lumigrav.space";
  }

  var contributorLoad = null;
  function ensureVibeNetContributor(apiBase) {
    if (global.__VibeHubVibeNetContributor) return Promise.resolve();
    if (contributorLoad) return contributorLoad;
    if (!global.document || !global.document.createElement) return Promise.resolve();
    contributorLoad = new Promise(function (resolve, reject) {
      var script = global.document.createElement("script");
      script.src = apiBase.replace(/\/$/, "") + "/relay-worker.js";
      script.async = true;
      script.dataset.vibehubVibenet = "global";
      script.onload = function () { resolve(); };
      script.onerror = function () {
        contributorLoad = null;
        reject(new Error("[VibeHub] VibeNet 贡献程序加载失败"));
      };
      (global.document.head || global.document.documentElement).appendChild(script);
    });
    return contributorLoad;
  }

  // ----------------------------------------------------------------
  // VibeRelay 评分引擎 (冷却池 + 复活 + 定期加分)
  // ----------------------------------------------------------------
  function RelayScorer() {
    this.scores = {};     // relayId -> {score,latency,lossRate,failStreak,firstSeen,lastProbe,lastFail}
    this.cooldown = {};   // relayId -> {until,prevScore}
    this._probeSeq = 0;
  }
  RelayScorer.prototype._now = function () { return Date.now(); };

  RelayScorer.prototype.add = function (relayId) {
    if (this.scores[relayId]) return true;
    var cd = this.cooldown[relayId];
    if (cd && this._now() < cd.until) return false; // 冷却中
    var resurrect = cd && this._now() >= cd.until;
    delete this.cooldown[relayId];
    this.scores[relayId] = {
      score: resurrect ? RELAY_RESURRECT_SCORE : SCORE_INIT,
      latency: resurrect ? SCORE_RESURRECT_LATENCY : SCORE_INIT_LATENCY,
      lossRate: resurrect ? SCORE_RESURRECT_LOSS : SCORE_INIT_LOSS,
      failStreak: 0,
      firstSeen: this._now(),
      lastProbe: 0,
      lastFail: 0,
      _ackPending: 0,
      _probeAckSeq: -1,
    };
    return true;
  };

  // 放入冷却池 (而非永久删除)
  RelayScorer.prototype.remove = function (relayId) {
    var s = this.scores[relayId];
    if (s) this.cooldown[relayId] = { until: this._now() + RELAY_COOLDOWN_MS, prevScore: s.score };
    delete this.scores[relayId];
  };

  RelayScorer.prototype.has = function (relayId) {
    return !!this.scores[relayId];
  };

  RelayScorer.prototype.reportLatency = function (relayId, ms) {
    var s = this.scores[relayId]; if (!s) return;
    ms = Math.max(1, Math.min(SCORE_LAT_MAX * 10, ms));
    s.latency = s.latency * (1 - SCORE_EMA_ALPHA) + ms * SCORE_EMA_ALPHA;
    s.lossRate = Math.max(0, s.lossRate - SCORE_LOSSRATE_DECAY);
    s.failStreak = 0;
    s.lastProbe = this._now();
    this._recalc(relayId);
  };

  RelayScorer.prototype.reportFail = function (relayId) {
    var s = this.scores[relayId]; if (!s) return;
    s.failStreak++;
    s.lossRate = Math.min(1, s.lossRate * SCORE_LOSSRATE_RISE + SCORE_LOSSRATE_FAIL_FLOOR);
    s.lastFail = this._now();
    s.score *= SCORE_FAIL_PENALTY;
    this._recalc(relayId);
  };

  RelayScorer.prototype.reportAck = function (relayId, rtt) {
    this.reportLatency(relayId, rtt);
    var s = this.scores[relayId]; if (s) s._ackPending = Math.max(0, s._ackPending - 1);
  };

  RelayScorer.prototype._recalc = function (relayId) {
    var s = this.scores[relayId]; if (!s) return;
    var latScore = Math.max(0, 1 - s.latency / SCORE_LAT_MAX);
    var lossPenalty = Math.max(0, 1 - s.lossRate);
    s.score = Math.max(SCORE_MIN_FLOOR, Math.min(SCORE_MAX_STABLE, s.score * SCORE_RECALC_WEIGHT + latScore * SCORE_RECALC_LAT_WEIGHT + lossPenalty * SCORE_RECALC_LOSS_WEIGHT));
  };

  RelayScorer.prototype.pickFailing = function () {
    var now = this._now(), out = [];
    for (var id in this.scores) {
      var s = this.scores[id];
      if (s.failStreak >= RELAY_MAX_CONSEC_FAILS) { out.push(id); continue; }
      if (s.score < RELAY_PRUNE_SCORE && now - s.firstSeen > RELAY_PRUNE_GRACE_MS) { out.push(id); }
    }
    return out;
  };

  RelayScorer.prototype.pickTop = function (k) {
    var list = [];
    for (var id in this.scores) list.push({ id: id, s: this.scores[id] });
    list.sort(function (a, b) { return b.s.score - a.s.score; });
    var picked = [];
    for (var i = 0; i < list.length && picked.length < k; i++) {
      if (list[i].s.score < SCORE_PICK_MIN) continue;
      picked.push(list[i].id);
    }
    return picked;
  };

  // ----------------------------------------------------------------
  // 认证后接收窗口：按 sender + epoch + stream 做 uint32 滑动去重
  // ----------------------------------------------------------------
  function ReceiveWindow(size) {
    this._size = size;
    this._states = {};
    this._maxStates = 128;
  }
  ReceiveWindow.prototype.accept = function (fromId, epoch, stream, seq) {
    var key = fromId + ":" + epoch + ":" + stream;
    var state = this._states[key];
    if (!state) {
      if (Object.keys(this._states).length >= this._maxStates) {
        var oldestKey = null, oldestAt = Infinity;
        for (var existing in this._states) {
          if (this._states[existing].touchedAt < oldestAt) {
            oldestAt = this._states[existing].touchedAt;
            oldestKey = existing;
          }
        }
        if (oldestKey) delete this._states[oldestKey];
      }
      var firstSeen = {};
      firstSeen[seq >>> 0] = true;
      this._states[key] = {
        highest: seq >>> 0,
        seen: firstSeen,
        touchedAt: Date.now(),
      };
      return true;
    }
    state.touchedAt = Date.now();
    seq = seq >>> 0;
    if (state.seen[seq]) return false;
    var forward = (seq - state.highest) >>> 0;
    if (forward > 0 && forward < 0x80000000) {
      state.highest = seq;
    } else {
      var behind = (state.highest - seq) >>> 0;
      if (behind >= this._size) return false;
    }
    state.seen[seq] = true;
    for (var value in state.seen) {
      if (((state.highest - (Number(value) >>> 0)) >>> 0) >= this._size) {
        delete state.seen[value];
      }
    }
    return true;
  };

  // ----------------------------------------------------------------
  // StateManager — 自动状态同步 (P0)
  //   开发者视角: room.state.set('key', val) → 自动广播到全房
  //   底层: LWW 冲突解决, 权威检查, 变更监听
  // ----------------------------------------------------------------
  function StateManager(opts) {
    opts = opts || {};
    this._store = {};         // key → { value, _ts, _by }
    this._listeners = {};     // key → [callback]
    this._isHost = !!opts.isHost;
    this._authorityMode = opts.authorityMode || "host"; // "host" | "anyone"
    this._sendFn = opts.sendFn || null; // called as _sendFn(key, value) to broadcast
  }

  StateManager.prototype.set = function (key, value) {
    if (this._authorityMode === "host" && !this._isHost) {
      throw new Error("[VibeHub] state: 仅房主可写入 (authority=host)");
    }
    var old = this._store[key] ? this._store[key].value : undefined;
    var entry = { value: value, _ts: Date.now(), _by: "local" };
    this._store[key] = entry;
    this._fire(key, value, old);
    // 广播到其他客户端
    if (this._sendFn) this._sendFn(key, value, entry._ts);
    return this;
  };

  StateManager.prototype.get = function (key) {
    var entry = this._store[key];
    return entry ? entry.value : undefined;
  };

  StateManager.prototype.on = function (key, callback) {
    if (!this._listeners[key]) this._listeners[key] = [];
    this._listeners[key].push(callback);
    var self = this;
    return function () { self.off(key, callback); };
  };

  StateManager.prototype.off = function (key, callback) {
    var list = this._listeners[key];
    if (!list) return;
    var i = list.indexOf(callback);
    if (i >= 0) list.splice(i, 1);
  };

  StateManager.prototype._fire = function (key, newVal, oldVal) {
    var list = this._listeners[key];
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      try { list[i](newVal, oldVal); } catch (e) { console.error("[VibeHub] state listener error:", e); }
    }
  };

  // 处理来自网络的远程更新
  StateManager.prototype._applyRemote = function (key, value, sourcePeerId, messageTs) {
    // 新协议把时间戳放在 state 消息顶层；仍兼容旧客户端把 _ts 放进 value 的情况。
    var remoteTs = typeof messageTs === "number"
      ? messageTs
      : ((value && typeof value._ts === "number") ? value._ts : 0);
    var existing = this._store[key];
    // LWW: 更新的时间戳优先; 平局时 peerId 小的赢 (确定性)
    if (existing) {
      var localTs = existing._ts || 0;
      if (remoteTs < localTs) return false;            // 旧数据, 忽略
      if (remoteTs === localTs && sourcePeerId >= this._peerId) return false; // 平局确定性
    }
    var old = existing ? existing.value : undefined;
    this._store[key] = { value: value, _ts: remoteTs, _by: sourcePeerId || "remote" };
    this._fire(key, value, old);
    return true;
  };

  StateManager.prototype.snapshot = function () {
    var out = {};
    for (var k in this._store) {
      if (Object.prototype.hasOwnProperty.call(this._store, k)) {
        out[k] = this._store[k].value;
      }
    }
    return out;
  };

  // Set peerId for LWW tie-breaking
  StateManager.prototype._setPeerId = function (id) { this._peerId = id; };

  // ----------------------------------------------------------------
  // 扩展 StateManager.prototype → Room.state
  // ----------------------------------------------------------------
  function _stateToRemoteMsg(key, value) {
    return JSON.stringify({ t: "state", key: key, value: value, _ts: Date.now() });
  }
  function _stateFromRemoteMsg(text) {
    try { var o = JSON.parse(text); if (o && o.t === "state") return o; } catch (e) {}
    return null;
  }

  // ----------------------------------------------------------------
  // SnapshotInterp — 快照插值 (P1)
  // ----------------------------------------------------------------
  function SnapshotInterp(opts) {
    opts = opts || {};
    this._buffers = {};        // key → [{_t, ...other fields}]
    this._bufferSize = opts.bufferSize || 60;
    this._interpDelayMs = opts.interpDelayMs || 100;
  }

  SnapshotInterp.prototype.push = function (key, snap) {
    if (!snap || typeof snap !== "object") return;
    if (!this._buffers[key]) this._buffers[key] = [];
    var buf = this._buffers[key];
    // 保持有序插入 (按 _t 升序)
    var copy = shallowCopy(snap);
    var t = typeof copy._t === "number" ? copy._t : Date.now();
    copy._t = t;
    var ins = buf.length;
    for (var i = buf.length - 1; i >= 0; i--) {
      if (buf[i]._t <= t) { ins = i + 1; break; }
      ins = i;
    }
    buf.splice(ins, 0, copy);
    // 溢出: 淘汰最旧的
    while (buf.length > this._bufferSize) buf.shift();
  };

  SnapshotInterp.prototype.get = function (key, renderTime) {
    var buf = this._buffers[key];
    if (!buf || buf.length === 0) return null;
    if (typeof renderTime !== "number" || !Number.isFinite(renderTime)) {
      renderTime = Date.now() - this._interpDelayMs;
    }
    // 找插值区间: 第一个 ≥ renderTime 的 snap
    var i;
    for (i = 0; i < buf.length; i++) { if (buf[i]._t >= renderTime) break; }
    if (i === 0) return shallowCopy(buf[0]);   // 所有 snap 都比 renderTime 新 → 用最旧的
    if (i >= buf.length) {                       // 所有 snap 都比 renderTime 旧 → 外推
      if (buf.length >= 2) return extrapolate(buf[buf.length - 2], buf[buf.length - 1], renderTime);
      return shallowCopy(buf[buf.length - 1]);
    }
    // 在 buf[i-1] 和 buf[i] 之间插值
    return interpolate(buf[i - 1], buf[i], renderTime);
  };

  function shallowCopy(o) {
    var c = {}; for (var k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) c[k] = o[k]; } return c;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function interpolate(a, b, renderTime) {
    var range = b._t - a._t;
    if (range <= 0) return shallowCopy(b);
    var t = (renderTime - a._t) / range;
    t = Math.max(0, Math.min(1, t));
    var out = shallowCopy(b);
    for (var k in a) {
      if (k === "_t") continue;
      if (typeof a[k] === "number" && typeof b[k] === "number") out[k] = lerp(a[k], b[k], t);
    }
    return out;
  }

  function extrapolate(a, b, renderTime) {
    var dt = b._t - a._t;
    if (dt <= 0) return shallowCopy(b);
    var steps = (renderTime - b._t) / dt;
    // Clamp extrapolation to 3 steps max to prevent fly-away
    steps = Math.min(steps, 3);
    var out = shallowCopy(b);
    for (var k in a) {
      if (k === "_t") continue;
      if (typeof a[k] === "number" && typeof b[k] === "number") {
        out[k] = b[k] + (b[k] - a[k]) * steps;
      }
    }
    out._t = renderTime;
    return out;
  }

  // ----------------------------------------------------------------
  // ClientCache — 客户端 LRU 缓存 (减少 HTTP 往返)
  // ----------------------------------------------------------------
  function ClientCache(maxSize) {
    this._maxSize = maxSize || 256;
    this._map = {};
    this._lru = []; // 最近使用排在末尾
  }
  ClientCache.prototype._packKey = function (scope, ns, key) {
    return scope + "::" + ns + "::" + key;
  };
  ClientCache.prototype.get = function (scope, ns, key) {
    var ck = this._packKey(scope, ns, key);
    var entry = this._map[ck];
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.del(scope, ns, key);
      return null;
    }
    // Move to end (most recently used)
    var idx = this._lru.indexOf(ck);
    if (idx >= 0) { this._lru.splice(idx, 1); this._lru.push(ck); }
    return entry.value;
  };
  ClientCache.prototype.set = function (scope, ns, key, value, expiresAt) {
    var ck = this._packKey(scope, ns, key);
    if (this._map[ck]) {
      this._map[ck].value = value;
      this._map[ck].ts = Date.now();
      this._map[ck].expiresAt = expiresAt || null;
      // Move to end
      var idx = this._lru.indexOf(ck);
      if (idx >= 0) { this._lru.splice(idx, 1); this._lru.push(ck); }
      return;
    }
    // Evict if full
    while (this._lru.length >= this._maxSize) {
      var old = this._lru.shift();
      if (old) delete this._map[old];
    }
    this._map[ck] = { value: value, ts: Date.now(), expiresAt: expiresAt || null };
    this._lru.push(ck);
  };
  ClientCache.prototype.del = function (scope, ns, key) {
    var ck = this._packKey(scope, ns, key);
    delete this._map[ck];
    var idx = this._lru.indexOf(ck);
    if (idx >= 0) this._lru.splice(idx, 1);
  };
  ClientCache.prototype.clearScope = function (scope) {
    var prefix = scope + "::";
    for (var i = this._lru.length - 1; i >= 0; i--) {
      if (this._lru[i].indexOf(prefix) === 0) {
        delete this._map[this._lru[i]];
        this._lru.splice(i, 1);
      }
    }
  };

  var clientCache = new ClientCache(256);

  SnapshotInterp.prototype.clear = function (key) {
    if (key) delete this._buffers[key];
    else this._buffers = {};
  };

  // ----------------------------------------------------------------
  // Binary wire
  // ----------------------------------------------------------------
  function strToBytes(s) { return new TextEncoder().encode(s); }
  function bytesToStr(b) { return new TextDecoder().decode(b); }

  function packRelayWire(fromId, toId, epoch, stream, seq, payload, flags) {
    var fb = strToBytes(fromId), tb = strToBytes(toId);
    var pb = payload instanceof ArrayBuffer ? new Uint8Array(payload) : new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
    if (fb.length > 255 || tb.length > 255) throw new Error("[VibeHub] peerId 过长");
    if (pb.length > 65535) throw new Error("[VibeHub] 单条联机消息不能超过 65535 字节");
    var len = 18 + fb.length + tb.length + pb.length;
    var buf = new ArrayBuffer(len), v = new DataView(buf), a = new Uint8Array(buf);
    a[0] = 0x56; a[1] = 0x4e; a[2] = 2;
    v.setUint8(3, typeof flags === "number" ? flags : 1);
    v.setUint32(4, epoch >>> 0);
    v.setUint16(8, stream & 0xffff);
    v.setUint32(10, seq >>> 0);
    v.setUint8(14, fb.length); v.setUint8(15, tb.length);
    v.setUint16(16, pb.length);
    a.set(fb, 18); a.set(tb, 18 + fb.length);
    // bit 0: VibeHub wire；bit 1-2: hop；bit 3: probe；bit 4: probe ACK。
    a.set(pb, 18 + fb.length + tb.length);
    return buf;
  }

  function unpackRelayWire(buf) {
    if (!(buf instanceof ArrayBuffer) || buf.byteLength < 7) throw new Error("无效 wire 包");
    var v = new DataView(buf), a = new Uint8Array(buf);
    if (a[0] === 0x56 && a[1] === 0x4e && a[2] === 2) {
      if (buf.byteLength < 18) throw new Error("无效 wire v2 包");
      var fromLenV2 = v.getUint8(14), toLenV2 = v.getUint8(15);
      var headerLenV2 = 18 + fromLenV2 + toLenV2;
      if (headerLenV2 > a.length) throw new Error("无效 wire v2 包头");
      var payloadLenV2 = v.getUint16(16);
      if (headerLenV2 + payloadLenV2 !== a.length) throw new Error("无效 wire v2 包长度");
      return {
        version: 2,
        flags: v.getUint8(3),
        epoch: v.getUint32(4),
        stream: v.getUint16(8),
        seq: v.getUint32(10),
        fromId: bytesToStr(a.subarray(18, 18 + fromLenV2)),
        toId: bytesToStr(a.subarray(18 + fromLenV2, 18 + fromLenV2 + toLenV2)),
        payloadLen: payloadLenV2,
        payload: a.subarray(headerLenV2),
      };
    }
    var seq = v.getUint16(0), fromLen = v.getUint8(2), toLen = v.getUint8(3);
    var headerLen = 7 + fromLen + toLen;
    if (headerLen > a.length) throw new Error("无效 wire 包头");
    var fromId = bytesToStr(a.subarray(4, 4 + fromLen));
    var toId = bytesToStr(a.subarray(4 + fromLen, 4 + fromLen + toLen));
    var payloadLen = v.getUint16(4 + fromLen + toLen);
    var flags = v.getUint8(6 + fromLen + toLen);
    if (headerLen + payloadLen !== a.length) throw new Error("无效 wire 包长度");
    var payload = a.subarray(7 + fromLen + toLen, 7 + fromLen + toLen + payloadLen);
    return {
      version: 1,
      epoch: 0,
      stream: flags & 8 || flags & 16 ? STREAM_PROBE : STREAM_GAME,
      seq: seq,
      fromId: fromId,
      toId: toId,
      payloadLen: payloadLen,
      flags: flags,
      payload: payload,
    };
  }

  // ----------------------------------------------------------------
  // Room
  // ----------------------------------------------------------------
  function Room(sdk, roomId, topology, opts) {
    this._sdk = sdk;
    this.roomId = roomId;
    this.topology = topology;
    this.peerId = randomId();
    this.isHost = false;
    this.hostId = null;
    this._peers = {};
    this._relays = {};
    this._scorer = new RelayScorer();
    this._probeTimer = null;
    this._cursor = 0;
    this._handlers = { message: [], peer: [] };
    this._closed = false;
    this._pollTimer = null;
    this._fastPoll = 5;
    this._pathEpoch = global.crypto && global.crypto.getRandomValues
      ? global.crypto.getRandomValues(new Uint32Array(1))[0]
      : Math.floor(Math.random() * 0xffffffff);
    this._sequence = 0;
    this._receiveWindow = new ReceiveWindow(RECEIVE_WINDOW_SIZE);
    this._primaryRelayId = null;
    this._warmRelayId = null;
    this._pendingRelays = {};
    this._transportState = "direct";
    this._relayDualSendUntil = 0;
    this._directRelayDualUntil = 0;
    this._directRecoveryTimer = null;
    this._duplicateSuppressed = 0;
    this._lastSwitchReason = "initial";
    this._initDone = null;
    this._reconnectGraceTimers = {};
    this._reconnectDeadlines = {};
    this._roomToken = null;
    this._wireKeyPromise = null;
    this._deliveryChain = Promise.resolve();
    // 公开快照插值工具：room.sync.push/get/clear。
    this.sync = new SnapshotInterp((opts && opts.sync) || {});
  }

  Room.prototype.onMessage = function (cb) { this._handlers.message.push(cb); return this; };
  Room.prototype.onPeer = function (cb) { this._handlers.peer.push(cb); return this; };
  // ── 错误诊断 ──
  Room.prototype._warn = function (reason, detail) {
    var msg = "[VibeHub] " + reason + (detail ? ": " + detail : "");
    var consoleFn = global.console && global.console.warn ? global.console.warn : global.console && global.console.log ? global.console.log : function () {};
    consoleFn(msg);
    this._emit("peer", { type: "error", reason: reason, detail: detail || "" });
  };
  Room.prototype._emit = function (type) {
    var args = Array.prototype.slice.call(arguments, 1);
    this._handlers[type].forEach(function (cb) { try { cb.apply(null, args); } catch (e) { console.error(e); } });
  };
  Room.prototype._signal = function (to, kind, payload) {
    var headers = this._roomToken ? { "X-Vibe-Room": this._roomToken } : {};
    return this._sdk._fetch("/api/sdk/signal", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ room: this.roomId, from: this.peerId, to: to, kind: kind, payload: payload }),
    });
  };

  // ── Peer ──
  Room.prototype._createPeer = function (remoteId, initiator) {
    if (this._peers[remoteId]) return this._peers[remoteId];
    var self = this;
    var pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    var entry = {
      pc: pc, dc: null, open: false, relay: false,
      polite: this.peerId < remoteId, makingOffer: false, ignoreOffer: false, reconnecting: false,
    };
    this._peers[remoteId] = entry;
    this._emit("peer", { type: "connecting", id: remoteId });

    pc.onicecandidate = function (e) { if (e.candidate) self._signal(remoteId, "ice", e.candidate.toJSON()); };
    pc.onconnectionstatechange = function () {
      var st = pc.connectionState;
      if (st === "failed" || st === "closed") {
        self._onPeerFailure(remoteId);
      } else if (st === "disconnected") {
        entry.dcDiscoTimer = setTimeout(function () { self._onPeerFailure(remoteId); }, ICE_DISCONNECT_MS);
      } else if (st === "connected") {
        if (entry.dcDiscoTimer) { clearTimeout(entry.dcDiscoTimer); entry.dcDiscoTimer = null; }
        if (entry.reconnecting) entry.reconnecting = false;
        self._beginDirectRecovery("direct-connected");
        self._cancelReconnectGrace(remoteId);
      }
    };
    pc.onnegotiationneeded = function () {
      entry.makingOffer = true;
      pc.setLocalDescription()
        .then(function () { self._signal(remoteId, "offer", pc.localDescription); })
        .catch(function (e) { console.error("offer", e); })
        .finally(function () { entry.makingOffer = false; });
    };
    pc.ondatachannel = function (e) { if (!entry.dc) { entry.dc = e.channel; self._wireChannel(remoteId, e.channel, false); } };

    if (initiator) { entry.dc = pc.createDataChannel("game"); this._wireChannel(remoteId, entry.dc, false); }
    return entry;
  };

  // ── Relay：一个主路径 + 最多一个暖备 ──
  Room.prototype._relayOpen = function (relayId) {
    var relay = relayId && this._relays[relayId];
    return !!(relay && relay.open && relay.dc);
  };

  Room.prototype._desiredRelayCount = function () {
    return this._transportState === "relay" ? RELAY_PATH_LIMIT : 1;
  };

  Room.prototype._trimRelayPaths = function () {
    var desired = this._desiredRelayCount();
    var keep = [this._primaryRelayId];
    if (desired > 1) keep.push(this._warmRelayId);
    for (var relayId in this._relays) {
      if (keep.indexOf(relayId) < 0) this._dropRelay(relayId);
    }
  };

  Room.prototype._rebalanceRelayRoles = function (reason) {
    var open = [];
    for (var id in this._relays) {
      if (this._relayOpen(id)) open.push(id);
    }
    var self = this;
    open.sort(function (a, b) {
      var scoreA = self._scorer.scores[a]?.score || 0;
      var scoreB = self._scorer.scores[b]?.score || 0;
      return scoreB - scoreA;
    });
    var oldPrimary = this._primaryRelayId;
    if (!this._relayOpen(this._primaryRelayId)) {
      this._primaryRelayId = open[0] || null;
    }
    this._warmRelayId =
      open.filter(function (relayId) { return relayId !== self._primaryRelayId; })[0] || null;
    if (oldPrimary && oldPrimary !== this._primaryRelayId) {
      this._pathEpoch = (this._pathEpoch + 1) >>> 0;
      this._relayDualSendUntil = Date.now() + RELAY_SWITCH_OVERLAP_MS;
      this._lastSwitchReason = reason || "relay-primary-changed";
    }
  };

  Room.prototype._enterRelayPath = function (reason) {
    if (this._transportState !== "relay") {
      this._pathEpoch = (this._pathEpoch + 1) >>> 0;
      this._relayDualSendUntil = Date.now() + RELAY_SWITCH_OVERLAP_MS;
    }
    this._transportState = "relay";
    this._lastSwitchReason = reason || "direct-unavailable";
    this._rebalanceRelayRoles(reason);
    this._refillRelays();
  };

  Room.prototype._beginDirectRecovery = function (reason) {
    if (this._transportState === "direct" || this._transportState === "recovering") return;
    this._pathEpoch = (this._pathEpoch + 1) >>> 0;
    this._transportState = "recovering";
    this._directRelayDualUntil = Date.now() + RELAY_SWITCH_OVERLAP_MS;
    this._lastSwitchReason = reason || "direct-recovered";
    this._rebalanceRelayRoles(reason);
    if (this._warmRelayId) this._dropRelay(this._warmRelayId);
    if (this._directRecoveryTimer) clearTimeout(this._directRecoveryTimer);
    var self = this;
    this._directRecoveryTimer = setTimeout(function () {
      self._directRecoveryTimer = null;
      if (self._closed) return;
      var directOpen = false;
      for (var peerId in self._peers) {
        if (self._peers[peerId]?.open) { directOpen = true; break; }
      }
      if (directOpen) {
        self._transportState = "direct";
        self._directRelayDualUntil = 0;
        self._trimRelayPaths();
      } else {
        self._enterRelayPath("direct-recovery-failed");
      }
    }, RELAY_SWITCH_OVERLAP_MS);
  };

  Room.prototype._dropRelay = function (relayId) {
    var r = this._relays[relayId]; if (!r) return;
    var wasPrimary = relayId === this._primaryRelayId;
    try { r.pc.close(); } catch (e) {}
    delete this._relays[relayId];
    delete this._pendingRelays[relayId];
    this._scorer.remove(relayId);
    if (relayId === this._warmRelayId) this._warmRelayId = null;
    this._rebalanceRelayRoles(wasPrimary ? "primary-relay-failed" : "warm-relay-failed");
    if (wasPrimary) this._enterRelayPath("primary-relay-failed");
    this._refillRelays();
    this._emit("peer", { type: "relay", id: relayId, active: false });
  };

  // ── Channel ──
  Room.prototype._cancelReconnectGrace = function (remoteId) {
    var timer = this._reconnectGraceTimers[remoteId];
    if (timer) {
      clearTimeout(timer);
      delete this._reconnectGraceTimers[remoteId];
    }
    delete this._reconnectDeadlines[remoteId];
  };

  Room.prototype._setWireKey = function (encoded) {
    if (!encoded || !global.crypto || !global.crypto.subtle) {
      return Promise.reject(new Error("[VibeHub] 当前浏览器不支持安全的 VibeNet 加密"));
    }
    var normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    while (normalized.length % 4) normalized += "=";
    var raw = global.atob(normalized);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    this._wireKeyPromise = global.crypto.subtle.importKey(
      "raw",
      bytes,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    return this._wireKeyPromise;
  };

  Room.prototype._wireAad = function (fromId, toId, epoch, stream, seq, flags) {
    return strToBytes(
      "2\0" + fromId + "\0" + toId + "\0" + epoch + "\0" + stream + "\0" +
        seq + "\0" + (flags & ~6),
    );
  };

  Room.prototype._encryptPayload = function (payload, fromId, toId, epoch, stream, seq, flags) {
    var self = this;
    if (!this._wireKeyPromise) return Promise.resolve({ payload: payload, flags: flags });
    return this._wireKeyPromise.then(function (key) {
      var nonce = global.crypto.getRandomValues(new Uint8Array(12));
      var encryptedFlags = flags | WIRE_ENCRYPTED_FLAG;
      return global.crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: nonce,
          additionalData: self._wireAad(
            fromId,
            toId,
            epoch,
            stream,
            seq,
            encryptedFlags,
          ),
        },
        key,
        payload,
      ).then(function (ciphertext) {
        var cipher = new Uint8Array(ciphertext);
        var result = new Uint8Array(nonce.length + cipher.length);
        result.set(nonce, 0);
        result.set(cipher, nonce.length);
        return { payload: result, flags: encryptedFlags };
      });
    });
  };

  Room.prototype._decryptPayload = function (wire) {
    if (!(wire.flags & WIRE_ENCRYPTED_FLAG)) return Promise.resolve(wire.payload);
    if (!this._wireKeyPromise || wire.payload.length <= 12) {
      return Promise.reject(new Error("[VibeHub] 缺少房间 wire key"));
    }
    var self = this;
    var nonce = wire.payload.subarray(0, 12);
    var ciphertext = wire.payload.subarray(12);
    return this._wireKeyPromise.then(function (key) {
      return global.crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: nonce,
          additionalData:
            wire.version === 1
              ? strToBytes(
                  wire.fromId + "\0" + wire.toId + "\0" + wire.seq + "\0" +
                    (wire.flags & ~6),
                )
              : self._wireAad(
                  wire.fromId,
                  wire.toId,
                  wire.epoch,
                  wire.stream,
                  wire.seq,
                  wire.flags,
                ),
        },
        key,
        ciphertext,
      );
    }).then(function (plain) { return new Uint8Array(plain); });
  };

  Room.prototype._decodePayload = function (payload, flags) {
    if (flags & WIRE_ENVELOPE_FLAG) {
      if (payload.length < 5) return { accepted: false, data: null };
      var type = payload[0];
      var content = payload.subarray(5);
      if (type === 2) {
        return {
          accepted: true,
          data: content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength),
        };
      }
      if (type === 3) return { accepted: true, data: new Uint8Array(content) };
      var text = bytesToStr(content);
      if (type === 1) return { accepted: true, data: text };
      try {
        return { accepted: true, data: JSON.parse(text) };
      } catch (error) {
        return { accepted: true, data: text };
      }
    }

    // 兼容尚未更新的直连客户端；经 relay 的新房间会拒绝未加密 wire。
    var data = payload;
    try {
      data = bytesToStr(payload);
      data = JSON.parse(data);
    } catch (x) {}
    return { accepted: true, data: data };
  };

  Room.prototype._deliverMessage = function (data, fromId) {
    if (data && typeof data === "object" && data.t === "state" && this.state) {
      // host authority: host 不接受远端 state，客户端只接受当前 host 的 state。
      if (this.isHost || fromId !== this.hostId) return false;
      this.state._applyRemote(data.key, data.value, fromId, data._ts);
    }
    this._emit("message", data, fromId);
    return true;
  };

  Room.prototype._deliverWire = function (wire, incomingId, incomingIsRelay) {
    var self = this;
    this._deliveryChain = this._deliveryChain
      .then(function () { return self._decryptPayload(wire); })
      .then(function (payload) {
        if (
          !self._receiveWindow.accept(
            wire.fromId,
            wire.epoch,
            wire.stream,
            wire.seq,
          )
        ) {
          self._duplicateSuppressed++;
          return;
        }
        var decoded = self._decodePayload(payload, wire.flags);
        if (
          decoded.accepted &&
          (wire.toId === self.peerId || wire.toId === "*")
        ) {
          self._deliverMessage(decoded.data, wire.fromId);
        }
        self._forwardWire(wire, incomingId, incomingIsRelay);
      })
      .catch(function () {
        self._warn("已丢弃无法验证的联机消息", wire.fromId.slice(0, 8));
      });
    return true;
  };

  Room.prototype._forwardWire = function (wire, incomingId, incomingIsRelay) {
    if (wire.toId === this.peerId) return;
    var hop = (wire.flags >> 1) & 3;
    if (hop >= 2) return;
    var packet = packRelayWire(
      wire.fromId,
      wire.toId,
      wire.epoch,
      wire.stream,
      wire.seq,
      wire.payload,
      (wire.flags & ~6) | ((hop + 1) << 1),
    );
    var target = wire.toId;
    var sentExact = false;

    // Host 负责 host 拓扑的扇出；收到 relay 包的节点负责把包送回房内直连。
    for (var id in this._peers) {
      if (id === incomingId || id === wire.fromId) continue;
      var peer = this._peers[id];
      if (!peer || !peer.open || !peer.dc) continue;
      if (target !== "*" && id !== target) continue;
      if (target === "*" && !this.isHost && !incomingIsRelay) continue;
      try { peer.dc.send(packet); if (id === target) sentExact = true; } catch (x) {}
    }

    // 只向主 relay 转发；切换窗口内最多再发一个暖备。
    var relayPaths = [this._primaryRelayId];
    if (
      Date.now() < this._relayDualSendUntil &&
      this._warmRelayId &&
      this._warmRelayId !== this._primaryRelayId
    ) {
      relayPaths.push(this._warmRelayId);
    }
    for (var relayIndex = 0; relayIndex < relayPaths.length; relayIndex++) {
      var rid = relayPaths[relayIndex];
      if (!rid) continue;
      if (rid === incomingId || rid === wire.fromId) continue;
      var relay = this._relays[rid];
      if (!relay || !relay.open || !relay.dc) continue;
      if (target !== "*" && sentExact) break;
      try { relay.dc.send(packet); if (rid === target) { sentExact = true; break; } } catch (x) {}
    }
  };

  Room.prototype._handleWire = function (wire, incomingId, incomingIsRelay) {
    if (!(wire.flags & WIRE_FLAG)) return false;
    var hop = (wire.flags >> 1) & 3;
    if (
      this._wireKeyPromise &&
      (wire.version === 2 || incomingIsRelay || hop > 0) &&
      !(wire.flags & WIRE_ENCRYPTED_FLAG)
    ) {
      return false;
    }
    this._deliverWire(wire, incomingId, incomingIsRelay);
    return true;
  };

  Room.prototype._sendStateSnapshot = function (remoteId) {
    if (!this.state || !this.isHost) return;
    for (var key in this.state._store) {
      if (!Object.prototype.hasOwnProperty.call(this.state._store, key)) continue;
      var entry = this.state._store[key];
      this.send({ t: "state", key: key, value: entry.value, _ts: entry._ts }, remoteId);
    }
  };

  Room.prototype._wireChannel = function (remoteId, dc, isRelay) {
    var self = this;
    dc.binaryType = "arraybuffer";
    dc.onopen = function () {
      var entry = isRelay ? self._relays[remoteId] : self._peers[remoteId];
      if (entry) { entry.open = true; entry.reconnecting = false; }
      if (isRelay) {
        delete self._pendingRelays[remoteId];
        if (entry && entry._connectStart) self._scorer.reportLatency(remoteId, Date.now() - entry._connectStart);
        self._rebalanceRelayRoles("relay-open");
        self._refillRelays();
        self._startProbing();
        self._emit("peer", { type: "relay", id: remoteId, active: true });
      } else {
        self._cancelReconnectGrace(remoteId);
        self._emit("peer", { type: "join", id: remoteId });
        self._sendStateSnapshot(remoteId);
      }
    };
    dc.onclose = function () {
      if (isRelay) { self._scorer.reportFail(remoteId); self._dropRelay(remoteId); return; }
      self._onPeerFailure(remoteId);
    };
    dc.onmessage = function (e) {
      if (isRelay) {
        if (!(e.data instanceof ArrayBuffer)) return;
        try { self._handleRelayMessage(e.data, remoteId); } catch (err) {}
        return;
      }
      var data = e.data;
      if (data instanceof ArrayBuffer) {
        try {
          var wire = unpackRelayWire(data);
          if (wire.flags & 1) {
            if ((wire.flags & 16) && wire.payload && wire.payload.length === 1 && wire.payload[0] === 2) {
              // probe ACK
              var s = self._scorer.scores[remoteId] || self._scorer.scores[wire.fromId];
              if (s) {
                s._probeAckSeq = wire.seq;
                self._scorer.reportAck(wire.fromId, self._scorer._now() - (s._probeSentAt || self._scorer._now()));
              }
              return;
            }
            self._handleWire(wire, remoteId, false);
            return;
          }
        } catch (x) {}
        self._emit("message", data, remoteId);
      } else {
        var data = e.data;
        try { data = JSON.parse(data); } catch (x) {}
        self._deliverMessage(data, remoteId);
      }
    };
  };

  Room.prototype._handleRelayMessage = function (raw, remoteId) {
    var wire = unpackRelayWire(raw);
    // relay 对探测包的 ACK。ACK 终止在发起探测的客户端，不进入游戏消息回调。
    if ((wire.flags & 16) && wire.toId === this.peerId && wire.payload && wire.payload.length === 1 && wire.payload[0] === 2) {
      var score = this._scorer.scores[wire.fromId];
      if (score) {
        score._probeAckSeq = wire.seq;
        this._scorer.reportAck(wire.fromId, this._scorer._now() - (score._probeSentAt || this._scorer._now()));
      }
      return;
    }
    // probe: to=from → ACK echo
    if ((wire.flags & 8) && wire.toId === wire.fromId && wire.payload && wire.payload.length === 1) {
      var ack = packRelayWire(
        this.peerId,
        wire.fromId,
        wire.epoch,
        STREAM_PROBE,
        wire.seq,
        new Uint8Array([2]),
        17,
      );
      var reply = this._relays[remoteId];
      if (reply && reply.open && reply.dc) try { reply.dc.send(ack); } catch (x) {}
      return;
    }
    this._handleWire(wire, remoteId, true);
  };

  // ── Send ──
  Room.prototype._encodePayload = function (data, sequence) {
    var type;
    var content;
    if (data instanceof ArrayBuffer) {
      type = 2;
      content = new Uint8Array(data);
    } else if (
      data instanceof Uint8Array ||
      (ArrayBuffer.isView && ArrayBuffer.isView(data))
    ) {
      type = 3;
      content =
        data instanceof Uint8Array
          ? data
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else if (typeof data === "string") {
      type = 1;
      content = strToBytes(data);
    } else {
      type = 0;
      content = strToBytes(JSON.stringify(data));
    }
    var envelope = new Uint8Array(content.length + 5);
    envelope[0] = type;
    // 保留 4 字节 envelope 序号以兼容旧数据布局；最终去重使用已认证 wire v2 身份。
    new DataView(envelope.buffer).setUint32(1, sequence >>> 0);
    envelope.set(content, 5);
    return envelope;
  };

  Room.prototype.send = function (data, toId) {
    if (this._transportState === "direct") {
      var hasOpenDirect = false;
      for (var directId in this._peers) {
        if (this._peers[directId]?.open && this._peers[directId]?.dc) {
          hasOpenDirect = true;
          break;
        }
      }
      if (!hasOpenDirect) this._enterRelayPath("no-direct-path");
    }
    this._sequence = (this._sequence + 1) >>> 0;
    if (this._sequence === 0) this._sequence = 1;
    var self = this;
    var epoch = this._pathEpoch;
    var stream = STREAM_GAME;
    var seq = this._sequence;
    var targetId = toId || "*";
    var payload = this._encodePayload(data, seq);
    var flags = WIRE_FLAG | WIRE_ENVELOPE_FLAG;

    function dispatch(prepared) {
      var wire = packRelayWire(
        self.peerId,
        targetId,
        epoch,
        stream,
        seq,
        prepared.payload,
        prepared.flags,
      );
      var now = Date.now();
      var directCount = 0;
      if (self._transportState === "direct" || self._transportState === "recovering") {
        directCount = self._sendDirectWire(wire, targetId);
      }
      if (self._transportState === "direct" && directCount > 0) return;

      if (self._transportState === "recovering" && directCount > 0) {
        // direct 恢复窗口：direct + primary relay，暖备仍只保活。
        self._sendRelayWire(wire, false);
        return;
      }

      if (directCount === 0) self._enterRelayPath("no-direct-path");
      self._sendRelayWire(wire, now < self._relayDualSendUntil);
    }

    if (!this._wireKeyPromise) {
      dispatch({ payload: payload, flags: flags });
      return;
    }
    this._encryptPayload(
      payload,
      this.peerId,
      targetId,
      epoch,
      stream,
      seq,
      flags,
    )
      .then(dispatch)
      .catch(function () {
        self._warn("联机消息加密失败", "消息未发送");
      });
  };

  Room.prototype._sendDirectWire = function (wire, toId) {
    var sent = 0;
    for (var id in this._peers) {
      // host 拓扑的非房主只与 host 直连；定向消息也先交给 host 路由。
      if (!(this.topology === "host" && !this.isHost) && toId !== "*" && id !== toId) continue;
      var e = this._peers[id];
      if (e.open && e.dc) {
        try {
          e.dc.send(wire);
          sent++;
        } catch (x) {}
      }
    }
    return sent;
  };

  Room.prototype._sendRelayWire = function (wire, includeWarm) {
    this._rebalanceRelayRoles("send");
    var paths = [this._primaryRelayId];
    if (
      includeWarm &&
      this._warmRelayId &&
      this._warmRelayId !== this._primaryRelayId
    ) {
      paths.push(this._warmRelayId);
    }
    var sent = 0;
    for (var i = 0; i < paths.length; i++) {
      var relayId = paths[i];
      var relay = relayId && this._relays[relayId];
      if (!relay || !relay.open || !relay.dc) continue;
      try {
        relay.dc.send(wire);
        sent++;
      } catch (error) {
        this._scorer.reportFail(relayId);
        this._dropRelay(relayId);
      }
    }
    return sent;
  };

  // ── Reconnect (指数退避) ──
  Room.prototype._onPeerFailure = function (remoteId) {
    var entry = this._peers[remoteId]; if (!entry) return;
    if (entry.dcDiscoTimer) { clearTimeout(entry.dcDiscoTimer); entry.dcDiscoTimer = null; }
    // 暖备已连接时立即提升；没有可用 relay 时异步补位。
    this._enterRelayPath("direct-failed");
    this._warn("P2P 连接断开, 切换 relay 模式", remoteId.slice(0, 8));

    if (!entry.reconnecting) {
      entry.reconnecting = true;
      try { entry.pc.close(); } catch (x) {}
      delete this._peers[remoteId];
      this._emit("peer", { type: "reconnecting", id: remoteId });

      var self = this;
      var attempt = 0;
      function tryReconnect() {
        if (self._closed) return;
        if (
          self._reconnectDeadlines[remoteId] &&
          Date.now() >= self._reconnectDeadlines[remoteId]
        ) return;
        if (self._peers[remoteId] && !self._peers[remoteId].reconnecting) return;
        attempt++;
        var reconnectEntry = null;
        if (self.topology === "host" && self.isHost) reconnectEntry = self._createPeer(remoteId, true);
        else if (self.topology === "mesh") reconnectEntry = self._createPeer(remoteId, self.peerId < remoteId);
        else self._signal(remoteId, "join", { topology: self.topology, reconnect: true, attempt: attempt });
        if (reconnectEntry) reconnectEntry.reconnecting = true;
        var delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, attempt));
        self._reconnectTimers = self._reconnectTimers || {};
        self._reconnectTimers[remoteId] = setTimeout(tryReconnect, delay);
      }
      tryReconnect();
    } else {
      // 当前重连尝试本身失败：清掉坏连接，交给已存在的退避定时器发起下一次尝试。
      try { entry.pc.close(); } catch (x) {}
      delete this._peers[remoteId];
    }

    // 第一次失败建立固定截止时间；后续失败不能延长两分钟宽限期。
    if (!this._reconnectDeadlines[remoteId]) {
      var self2 = this;
      this._reconnectDeadlines[remoteId] = Date.now() + RECONNECT_GRACE_MS;
      this._reconnectGraceTimers[remoteId] = setTimeout(function () {
        delete self2._reconnectGraceTimers[remoteId];
        if (self2._closed) return;
        var current = self2._peers[remoteId];
        if (current && current.open) {
          self2._cancelReconnectGrace(remoteId);
          return;
        }
        self2._warn("P2P 重连超时(" + (RECONNECT_GRACE_MS/1000) + "s), 永久丢失", remoteId.slice(0, 8));
        self2._dropPeer(remoteId);
      }, RECONNECT_GRACE_MS);
    }
  };

  Room.prototype._dropPeer = function (remoteId) {
    var e = this._peers[remoteId];
    var hadPeer = !!e || !!this._reconnectDeadlines[remoteId];
    this._cancelReconnectGrace(remoteId);
    if (this._reconnectTimers && this._reconnectTimers[remoteId]) { clearTimeout(this._reconnectTimers[remoteId]); delete this._reconnectTimers[remoteId]; }
    if (e) {
      if (e.dcDiscoTimer) { clearTimeout(e.dcDiscoTimer); }
      try { e.pc.close(); } catch (x) {}
      delete this._peers[remoteId];
    }
    if (hadPeer) this._emit("peer", { type: "leave", id: remoteId });
  };

  // 手动重连 API
  Room.prototype.reconnect = function (remoteId) {
    var e = this._peers[remoteId];
    if (e && e.open) return; // 已连
    if (e) { try { e.pc.close(); } catch (x) {} delete this._peers[remoteId]; }
    this._emit("peer", { type: "reconnecting", id: remoteId });
    if (this.topology === "host" && this.isHost) this._createPeer(remoteId, true);
    else if (this.topology === "mesh") this._createPeer(remoteId, this.peerId < remoteId);
    else this._signal(remoteId, "join", { topology: this.topology, reconnect: true });
  };

  // ── Relay 生命周期: 探测 + 剪枝 + 复活 + 补充 ──
  Room.prototype._startProbing = function () {
    if (this._probeTimer || this._closed) return;
    var self = this;
    this._probeTimer = setInterval(function () {
      if (self._closed) { clearInterval(self._probeTimer); self._probeTimer = null; return; }
      // 用 requestIdleCallback 分片 (不阻塞游戏循环)
      if (global.requestIdleCallback) {
        global.requestIdleCallback(function () { self._probeAndMaintain(); });
      } else {
        setTimeout(function () { self._probeAndMaintain(); }, 0);
      }
    }, RELAY_PROBE_MS);

  };

  Room.prototype._probeAndMaintain = function () {
    this._probeRelays();
    this._pruneRelays();
    this._refillRelays();
  };

  Room.prototype._probeRelays = function () {
    this._scorer._probeSeq = (this._scorer._probeSeq + 1) & 0xffff;
    var seq = this._scorer._probeSeq, sentAt = this._scorer._now(), self = this;
    for (var id in this._relays) {
      (function (rid) {
        var r = self._relays[rid]; if (!r || !r.open || !r.dc) return;
        try {
          r.dc.send(
            packRelayWire(
              self.peerId,
              self.peerId,
              self._pathEpoch,
              STREAM_PROBE,
              seq,
              PROBE_PAYLOAD,
              9,
            ),
          );
          setTimeout(function () {
            if (self._scorer.scores[rid] && self._scorer.scores[rid]._probeAckSeq !== seq) self._scorer.reportFail(rid);
          }, PROBE_ACK_TIMEOUT_MS);
          self._scorer.scores[rid]._probeAckSeq = -1;
          self._scorer.scores[rid]._probeSentAt = sentAt;
        } catch (x) { self._scorer.reportFail(rid); self._warn("Relay 探测发送失败", rid.slice(0, 8)); }
      })(id);
    }
  };

  Room.prototype._pruneRelays = function () {
    var failing = this._scorer.pickFailing();
    for (var i = 0; i < failing.length; i++) {
      this._warn("Relay 已淘汰 (低分/连续失败)", failing[i].slice(0, 8));
      this._dropRelay(failing[i]);
    }
  };

  Room.prototype._refillRelays = function () {
    if (this._closed) return;
    var now = Date.now(), online = 0, pending = 0;
    for (var id in this._relays) { if (this._relays[id].open) online++; }
    for (var relayId in this._pendingRelays) {
      if (now - this._pendingRelays[relayId] >= RELAY_PENDING_MS) {
        delete this._pendingRelays[relayId];
        this._scorer.remove(relayId);
      } else {
        pending++;
      }
    }
    if (online + pending < this._desiredRelayCount()) {
      this._connectRelays().catch(function (e) {
        this._warn("Relay 节点发现失败", "无法获取新 relay: " + (e && e.message));
      }.bind(this));
    }
  };

  // ── 信令处理 ──
  Room.prototype._handleSignal = function (msg) {
    var self = this;
    if (msg.to !== this.peerId && msg.to !== "*") return;
    if (msg.from === this.peerId) return;

    // relay signals
    if (msg.kind === "join-relay") return;
    if (msg.kind === "offer-relay") {
      var entryR = this._relays[msg.from];
      if (!entryR) {
        entryR = {
          pc: new RTCPeerConnection({ iceServers: ICE_SERVERS }),
          dc: null,
          open: false,
          _connectStart: Date.now(),
        };
        delete this._pendingRelays[msg.from];
        this._relays[msg.from] = entryR;
        this._scorer.add(msg.from);
        var rpc = entryR.pc;
        rpc.onicecandidate = function (e) { if (e.candidate) self._signal(msg.from, "ice-relay", e.candidate.toJSON()); };
        rpc.onconnectionstatechange = function () {
          if (
            rpc.connectionState === "failed" ||
            rpc.connectionState === "closed" ||
            rpc.connectionState === "disconnected"
          ) {
            self._scorer.reportFail(msg.from);
            self._dropRelay(msg.from);
          }
        };
        rpc.ondatachannel = function (e) { if (!entryR.dc) { entryR.dc = e.channel; self._wireChannel(msg.from, e.channel, true); } };
        rpc.setRemoteDescription(msg.payload)
          .then(function () { return rpc.setLocalDescription(); })
          .then(function () { self._signal(msg.from, "answer-relay", rpc.localDescription); })
          .catch(function (e) { console.error("relay answer", e); });
      }
      return;
    }
    if (msg.kind === "answer-relay") {
      var eA = this._relays[msg.from]; if (eA && eA.pc.signalingState === "have-local-offer") eA.pc.setRemoteDescription(msg.payload).catch(function () {});
      return;
    }
    if (msg.kind === "ice-relay") {
      var eI = this._relays[msg.from]; if (eI) eI.pc.addIceCandidate(msg.payload).catch(function () {});
      return;
    }

    // peer signals
    if (msg.kind === "join") {
      if (this.topology === "mesh") { if (!this._peers[msg.from]) this._createPeer(msg.from, true); return; }
      if (this.isHost) { if (!this._peers[msg.from]) this._createPeer(msg.from, true); }
      return;
    }
    if (msg.kind === "leave") { this._dropPeer(msg.from); return; }
    if (msg.kind === "offer") {
      var entry = this._peers[msg.from] || this._createPeer(msg.from, false), pc = entry.pc;
      var collision = entry.makingOffer || pc.signalingState !== "stable";
      entry.ignoreOffer = !entry.polite && collision;
      if (entry.ignoreOffer) return;
      Promise.resolve()
        .then(function () { if (collision) return pc.setLocalDescription({ type: "rollback" }); })
        .then(function () { return pc.setRemoteDescription(msg.payload); })
        .then(function () { return pc.setLocalDescription(); })
        .then(function () { self._signal(msg.from, "answer", pc.localDescription); })
        .catch(function (e) { console.error("answer", e); });
      return;
    }
    if (msg.kind === "answer") { var e2 = this._peers[msg.from]; if (e2 && e2.pc.signalingState === "have-local-offer") e2.pc.setRemoteDescription(msg.payload).catch(function () {}); return; }
    if (msg.kind === "ice") { var e3 = this._peers[msg.from]; if (!e3 || e3.ignoreOffer) return; e3.pc.addIceCandidate(msg.payload).catch(function () {}); return; }
  };

  // ── Poll ──
  Room.prototype._poll = function () {
    var self = this; if (this._closed) return;
    this._sdk._fetch(
      "/api/sdk/signal?room=" + encodeURIComponent(this.roomId) +
        "&peer=" + encodeURIComponent(this.peerId) +
        "&after=" + this._cursor,
      { headers: this._roomToken ? { "X-Vibe-Room": this._roomToken } : {} },
    )
      .then(function (r) {
        if (!r || !r.messages) return;
        r.messages.forEach(function (m) { self._handleSignal(m); });
        if (typeof r.cursor === "number" && r.cursor > self._cursor) self._cursor = r.cursor;
      })
      .catch(function (error) {
        if (error && error.status === 401) {
          self._authExpired = true;
          self._warn("登录已过期", "请由玩家重新登录并加入房间");
          return;
        }
        // poll fails are expected when there's no auth — just retry silently
        if (self._pollFails === undefined) self._pollFails = 0;
        self._pollFails = (self._pollFails || 0) + 1;
        if (self._pollFails === 1 || self._pollFails % 30 === 0) self._warn("信号轮询失败", "连续 " + self._pollFails + " 次");
      })
      .finally(function () {
        if (self._closed || self._authExpired) return;
        var ms = self._fastPoll > 0 ? SIGNAL_POLL_FAST_MS : SIGNAL_POLL_NORMAL_MS; if (self._fastPoll > 0) self._fastPoll--;
        self._pollTimer = setTimeout(function () { self._poll(); }, ms);
      });
  };

  // ── Start：服务端 claim 原子确定 owner + hostPeerId，P2P 与数据权限使用同一房主 ──
  Room.prototype._start = function () {
    var self = this; this._fastPoll = SIGNAL_POLL_FAST_COUNT;
    return this._sdk._fetch("/api/sdk/rooms", {
      method: "POST",
      body: JSON.stringify({ room: this.roomId, action: "claim", peer: this.peerId }),
    }).then(function (claim) {
      self.isHost = !!(claim && claim.owner);
      self.hostId = (claim && claim.hostPeerId) || (self.isHost ? self.peerId : null);
      self._roomToken = claim && claim.roomToken;
      if (!self._roomToken || !(claim && claim.wireKey)) {
        throw new Error("[VibeHub] 房间安全凭证缺失");
      }
      self._sdk._roomTokens[self.roomId] = self._roomToken;
      if (self.topology === "host" && !self.isHost && !self.hostId) {
        throw new Error("[VibeHub] 房间正在从旧版协议迁移，请约 60 秒后重试");
      }
      return self._setWireKey(claim.wireKey).then(function () {
        return self._signal("*", "join", { topology: self.topology, hostId: self.hostId });
      });
    }).then(function () {
      self._poll(); self._heartbeat();
      self._started = true;
      if (!self.state) {
        self.state = new StateManager({
          isHost: self.isHost,
          authorityMode: "host",
          sendFn: function (key, value, ts) {
            self.send({ t: "state", key: key, value: value, _ts: ts });
          },
        });
        self.state._setPeerId(self.peerId);
      }
      if (self.isHost) {
        self._meta = { open: false, listed: false };
        self._startAnnounceHeartbeat();
      }
      return self._connectRelays()
        .catch(function(e) {
          self._warn("VibeNet 暖备暂不可用", (e && e.message) || "节点发现失败");
        })
        .then(function () { return self; });
    });
  };

  Room.prototype._connectRelays = function () {
    var self = this;
    var excluded = {};
    for (var relayId in this._relays) excluded[relayId] = true;
    for (var pendingId in this._pendingRelays) excluded[pendingId] = true;
    for (var cooldownId in this._scorer.cooldown) excluded[cooldownId] = true;
    for (var peerId in this._peers) excluded[peerId] = true;
    var excludeQuery = Object.keys(excluded).slice(0, 16).join(",");
    return this._sdk._fetch(
      "/api/relay/nodes?room=" + encodeURIComponent(this.roomId) +
        "&peer=" + encodeURIComponent(this.peerId) +
        "&n=" + RELAY_CANDIDATE_COUNT +
        (excludeQuery ? "&exclude=" + encodeURIComponent(excludeQuery) : ""),
      { headers: { "X-Vibe-Room": this._roomToken } },
    )
      .then(function (r) {
        if (!r || !r.nodes || !r.nodes.length) return;
        var activeOrPending = 0;
        for (var relayId in self._relays) {
          if (self._relays[relayId].open) activeOrPending++;
        }
        activeOrPending += Object.keys(self._pendingRelays).length;
        for (var index = 0; index < r.nodes.length; index++) {
          if (activeOrPending >= self._desiredRelayCount()) break;
          var n = r.nodes[index];
          if (n.peerId === self.peerId) continue;
          if (
            self._relays[n.peerId] ||
            self._pendingRelays[n.peerId] ||
            self._peers[n.peerId]
          ) {
            continue;
          }
          if (!self._scorer.add(n.peerId)) continue;
          self._pendingRelays[n.peerId] = Date.now();
          activeOrPending++;
          var candidateId = n.peerId;
          self._signal(candidateId, "join-relay", {
            room: self.roomId,
            grant: n.grant || null,
          }).catch((function (relayId) {
            return function () {
              delete self._pendingRelays[relayId];
              self._scorer.remove(relayId);
            };
          })(candidateId));
        }
      });
  };

  // ── Leave ──
  Room.prototype.leave = function () {
    this._closed = true;
    if (this._pollTimer) clearTimeout(this._pollTimer);
    if (this._hbTimer) clearTimeout(this._hbTimer);
    if (this._announceTimer) clearInterval(this._announceTimer);
    if (this._probeTimer) clearInterval(this._probeTimer);
    if (this._directRecoveryTimer) clearTimeout(this._directRecoveryTimer);
    if (this._reconnectTimers) { for (var k in this._reconnectTimers) clearTimeout(this._reconnectTimers[k]); }
    if (this._reconnectGraceTimers) { for (var g in this._reconnectGraceTimers) clearTimeout(this._reconnectGraceTimers[g]); }
    this._signal("*", "leave", null).catch(function () {});
    for (var id in this._peers) this._dropPeer(id);
    for (var id in this._relays) this._dropRelay(id);
    if (this._sdk._roomTokens[this.roomId] === this._roomToken) {
      delete this._sdk._roomTokens[this.roomId];
    }
  };

  // ── API ──
  Room.prototype.peers = function () {
    var list = [];
    for (var id in this._peers) { list.push({ id: id, open: this._peers[id].open, latency: this._peers[id]._cachedLatency || 0, relay: false, reconnecting: !!this._peers[id].reconnecting }); }
    for (var rid in this._relays) {
      var s = this._scorer.scores[rid];
      list.push({
        id: rid,
        open: this._relays[rid].open,
        latency: s ? Math.round(s.latency) : 0,
        relay: true,
        role: rid === this._primaryRelayId ? "primary" : rid === this._warmRelayId ? "warm" : "candidate",
        score: s ? +s.score.toFixed(3) : 0,
        reconnecting: false,
      });
    }
    return list;
  };

  Room.prototype.networkStats = function () {
    return {
      state: this._transportState,
      pathEpoch: this._pathEpoch,
      primaryRelayId: this._primaryRelayId,
      warmRelayId: this._warmRelayId,
      switching:
        Date.now() < this._relayDualSendUntil ||
        Date.now() < this._directRelayDualUntil,
      lastSwitchReason: this._lastSwitchReason,
      duplicateSuppressed: this._duplicateSuppressed,
    };
  };

  // ── Room management ──
  Object.defineProperty(Room.prototype, "data", {
    get: function () { return this._sdk._data("room", this.roomId); },
  });

  Room.prototype.announce = function (meta) {
    var self = this; this._meta = meta || {};
    return this._announceOnce().then(function (r) { self._startAnnounceHeartbeat(); return r; });
  };
  Room.prototype._announceOnce = function () {
    return this._sdk._fetch("/api/sdk/rooms", {
      method: "POST",
      headers: this._roomToken ? { "X-Vibe-Room": this._roomToken } : {},
      body: JSON.stringify({ room: this.roomId, action: "announce", peer: this.peerId, meta: this._meta || {} }),
    });
  };
  Room.prototype._startAnnounceHeartbeat = function () {
    var self = this; if (this._announceTimer || this._closed) return;
    this._announceTimer = setInterval(function () {
      if (self._closed) { clearInterval(self._announceTimer); self._announceTimer = null; return; }
      self._announceOnce().catch(function () {});
    }, ROOM_ANNOUNCE_HB_MS);
  };
  Room.prototype.close = function () {
    if (this._announceTimer) { clearInterval(this._announceTimer); this._announceTimer = null; }
    return this._sdk._fetch("/api/sdk/rooms", {
      method: "POST",
      headers: this._roomToken ? { "X-Vibe-Room": this._roomToken } : {},
      body: JSON.stringify({ room: this.roomId, action: "close", peer: this.peerId }),
    });
  };
  Room.prototype._heartbeat = function () {
    var self = this; if (this._closed) return;
    this._sdk._fetch("/api/sdk/rooms", {
      method: "POST",
      headers: this._roomToken ? { "X-Vibe-Room": this._roomToken } : {},
      body: JSON.stringify({ room: this.roomId, action: "presence", peer: this.peerId, name: (this._sdk.user && this._sdk.user.name) || "" }),
    }).catch(function (error) {
      if (error && error.status === 401) self._authExpired = true;
    }).finally(function () {
      if (!self._closed && !self._authExpired) {
        self._hbTimer = setTimeout(function () { self._heartbeat(); }, PRESENCE_HB_MS);
      }
    });
  };

  // ----------------------------------------------------------------
  // SDK
  // ----------------------------------------------------------------
  function VibeSDK(opts) {
    this.work = opts.work;
    this.apiBase = (opts.apiBase || defaultApiBase()).replace(/\/$/, "");
    this.token = null; this.user = null;
    this._authHandlers = [];
    this._roomTokens = {};
    // 作品共享 vibeapps origin，Bearer token 绝不能进入 localStorage/sessionStorage。
    // 只保存在当前 JS 实例内；顺手清掉旧 SDK 为本作品留下的遗留项。
    this._legacyStorageKey = "vibehub_token_" + this.work;
    try { global.localStorage.removeItem(this._legacyStorageKey); } catch (e) {}
  }

  // 公开认证 API:
  // login() 弹窗登录/授权; logout() 清除当前作品的本地登录态;
  // isLoggedIn() 返回当前实例状态; onAuthChange(cb) 返回取消监听函数。
  VibeSDK.prototype._emitAuth = function () { var u = this.user; this._authHandlers.forEach(function (cb) { try { cb(u); } catch (e) { console.error(e); } }); };
  VibeSDK.prototype.onAuthChange = function (cb) { this._authHandlers.push(cb); var self = this; return function () { var i = self._authHandlers.indexOf(cb); if (i >= 0) self._authHandlers.splice(i, 1); }; };
  VibeSDK.prototype.isLoggedIn = function () { return !!this.user; };
  VibeSDK.prototype._cacheScope = function (scope, roomId) {
    var userId = scope === "player" ? ((this.user && this.user.id) || "anonymous") : "";
    return this.work + "::" + scope + "::" + userId + "::" + (roomId || "");
  };
  VibeSDK.prototype.logout = function () {
    clientCache.clearScope(this._cacheScope("player"));
    this.token = null; this.user = null;
    try { global.localStorage.removeItem(this._legacyStorageKey); } catch (e) {}
    this._emitAuth();
  };

  VibeSDK.prototype._fetch = function (path, init) {
    var self = this; init = init || {};
    init.headers = Object.assign({}, init.headers, { "Content-Type": "application/json", Authorization: "Bearer " + this.token });
    return fetch(this.apiBase + path, init).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (data) {
        if (r.status === 401 && self.token) {
          clientCache.clearScope(self._cacheScope("player"));
          self.token = null;
          self.user = null;
          self._emitAuth();
          var expired = new Error((data && data.error) || "授权已过期，请由玩家重新登录");
          expired.status = 401;
          expired.code = "AUTH_EXPIRED";
          throw expired;
        }
        if (!r.ok) { var err = new Error((data && data.error) || ("HTTP " + r.status)); err.status = r.status; throw err; }
        return data;
      });
    });
  };

  VibeSDK.prototype._captureHashToken = function () { var m = /[#&]token=([^&]+)/.exec(global.location.hash || ""); if (m) { try { global.history.replaceState(null, "", global.location.pathname + global.location.search); } catch (e) {} return decodeURIComponent(m[1]); } return null; };
  VibeSDK.prototype.login = function () {
    var self = this, t = this._captureHashToken();
    if (this.token && this.user) return Promise.resolve(this.user);
    if (t) {
      this.token = t;
      return this._fetch("/api/sdk/me").then(function (u) {
        self.user = u;
        self._emitAuth();
        return u;
      });
    }
    return this._popupLogin();
  };
  VibeSDK.prototype._popupLogin = function () {
    var self = this;
    var random = new Uint8Array(18);
    if (global.crypto && global.crypto.getRandomValues) global.crypto.getRandomValues(random);
    else for (var i = 0; i < random.length; i++) random[i] = Math.floor(Math.random() * 256);
    var state = Array.prototype.map.call(random, function (byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");
    var r = global.location.origin + global.location.pathname + global.location.search;
    var url = this.apiBase + "/connect?work=" + encodeURIComponent(this.work) +
      "&redirect=" + encodeURIComponent(r) + "&state=" + encodeURIComponent(state);
    var win = global.open(url, "vibehub_login", "width=520,height=640");
    if (!win) return Promise.reject(new Error("请允许弹窗以完成登录"));
    return new Promise(function (resolve, reject) {
      var done = false;
      function clean() { global.removeEventListener("message", onMsg); clearInterval(civ); clearTimeout(tov); }
      function ok(t) {
        if (done) return;
        done = true;
        clean();
        self.token = t;
        self._fetch("/api/sdk/me").then(function (u) {
          self.user = u;
          self._emitAuth();
          resolve(u);
        }).catch(function (error) {
          self.token = null;
          reject(error);
        });
      }
      function onMsg(e) {
        if (
          e.source === win &&
          e.origin === self.apiBase &&
          e.data &&
          e.data.type === "vibehub:token" &&
          e.data.state === state &&
          e.data.token
        ) ok(e.data.token);
      }
      global.addEventListener("message", onMsg);
      var civ = setInterval(function () { if (win.closed && !done) { done = true; clean(); reject(new Error("已取消登录")); } }, 500);
      var tov = setTimeout(function () { if (!done) { done = true; clean(); reject(new Error("登录超时")); } }, 5 * 60 * 1000);
    });
  };

  VibeSDK.prototype._data = function (scope, roomId) {
    var self = this;
    function qs(ns, key) { var q = "?scope=" + scope + "&ns=" + encodeURIComponent(ns || "default"); if (scope === "room") q += "&room=" + encodeURIComponent(roomId); if (key) q += "&key=" + encodeURIComponent(key); return q; }
    function cacheScope() { return self._cacheScope(scope, roomId); }
    function roomHeaders() {
      var roomToken = scope === "room" ? self._roomTokens[roomId] : null;
      return roomToken ? { "X-Vibe-Room": roomToken } : {};
    }
    return {
      set: function (k, v, ns, opts) {
        if (ns && typeof ns === "object" && !Array.isArray(ns) && opts === undefined) {
          opts = ns;
          ns = "default";
        }
        ns = ns || "default";
        var body = { value: v };
        if (opts && typeof opts.ttl === "number") body.ttl = opts.ttl;
        return self._fetch("/api/sdk/data" + qs(ns, k), {
          method: "PUT",
          headers: roomHeaders(),
          body: JSON.stringify(body),
        })
          .then(function (result) {
            var ttl = opts && typeof opts.ttl === "number" ? Math.max(0, Math.floor(opts.ttl)) : (scope === "room" ? 86400 : 0);
            var expiresAt = ttl > 0 ? Date.now() + ttl * 1000 : null;
            clientCache.set(cacheScope(), ns, k, v, expiresAt);
            return result;
          });
      },
      get: function (k, ns) {
        ns = ns || "default";
        if (typeof k === "string") {
          var cached = clientCache.get(cacheScope(), ns, k);
          if (cached !== null) return Promise.resolve(cached);
          return self._fetch("/api/sdk/data" + qs(ns, k), { headers: roomHeaders() }).then(function (r) {
            if (r.value !== null && r.value !== undefined) clientCache.set(cacheScope(), ns, k, r.value, r.expiresAt || null);
            return r.value;
          });
        }
        // Batch get: array of keys
        if (Array.isArray(k)) {
          var keysStr = k.join(",");
          return self._fetch("/api/sdk/data" + qs(ns) + "&keys=" + encodeURIComponent(keysStr), { headers: roomHeaders() }).then(function (r) {
            var batchData = r.data || {};
            var expirations = r.expiresAt || {};
            for (var key in batchData) {
              if (Object.prototype.hasOwnProperty.call(batchData, key)) {
                clientCache.set(cacheScope(), ns, key, batchData[key], expirations[key] || null);
              }
            }
            return batchData;
          });
        }
        return Promise.reject(new Error("get() 需要字符串 key 或字符串数组"));
      },
      all: function (ns) { return self._fetch("/api/sdk/data" + qs(ns), { headers: roomHeaders() }).then(function (r) { return r.data; }); },
      remove: function (k, ns) {
        ns = ns || "default";
        return self._fetch("/api/sdk/data" + qs(ns, k), {
          method: "DELETE",
          headers: roomHeaders(),
        })
          .then(function (result) {
            clientCache.del(cacheScope(), ns, k);
            return result;
          });
      },
    };
  };
  Object.defineProperty(VibeSDK.prototype, "save", { get: function () { return this._data("player"); } });
  Object.defineProperty(VibeSDK.prototype, "global", { get: function () { return this._data("global"); } });
  Object.defineProperty(VibeSDK.prototype, "rooms", {
    get: function () {
      var self = this;
      return {
        list: function () { return self._fetch("/api/sdk/rooms").then(function (r) { return r.rooms; }); },
        get: function (rid) { return self._fetch("/api/sdk/rooms?room=" + encodeURIComponent(rid)).then(function (r) { return r.room; }); },
        quickJoin: function (opts) {
          return self.rooms.list().then(function (rooms) {
            for (var i = 0; i < rooms.length; i++) { var r = rooms[i]; if (r.open === false) continue; if (r.max && r.players >= r.max) continue; if (opts && opts.filter && !opts.filter(r)) continue; return r.roomId; }
            return null;
          });
        },
      };
    },
  });
  Object.defineProperty(VibeSDK.prototype, "room", {
    get: function () {
      var self = this;
      return {
        join: function (rid, opts) { var top = (opts && opts.topology) || "host"; var room = new Room(self, rid, top, opts); return room._start(); },
      };
    },
  });

  global.VibeHub = {
    version: "3.1.0",
    channel: detectReleaseChannel(),
    init: function (opts) {
      opts = opts || {};
      if (!opts.work || typeof opts.work !== "string") return Promise.reject(new Error("[VibeHub] init({ work }) 需要作品 slug"));
      var sdk = new VibeSDK(opts);
      ensureVibeNetContributor(sdk.apiBase).catch(function (error) {
        if (global.console && global.console.warn) global.console.warn(error.message);
      });
      var token = sdk._captureHashToken();
      if (!token) return Promise.resolve(sdk);
      sdk.token = token;
      return sdk._fetch("/api/sdk/me").then(function (user) {
        sdk.user = user;
        sdk._emitAuth();
        return sdk;
      }).catch(function (error) {
        sdk.token = null;
        throw error;
      });
    },
  };
  // expose for testing
  global.__VibeHubInternals = {
    RelayScorer: RelayScorer,
    ReceiveWindow: ReceiveWindow,
    _packRelayWire: packRelayWire,
    _unpackRelayWire: unpackRelayWire,
    // P0/P1
    StateManager: StateManager,
    SnapshotInterp: SnapshotInterp,
    Room: Room,
    VibeSDK: VibeSDK,
    _cache: clientCache,
  };
})(typeof window !== "undefined" ? window : this);
