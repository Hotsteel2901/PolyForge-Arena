/*!
 * VibeHub VibeNet Contributor — 登录无关的全局浏览器中继节点
 *
 * 页面存活时尽力贡献；Web Locks 保证同源只有一个 active 节点。
 * 节点只转发持有 relay + work + room + player grant 的加密 SDK wire，
 * 不是通用网络代理。
 */
((global) => {
  "use strict";

  if (global.__VibeHubVibeNetContributor) return;

  var API = (() => {
    try {
      var scriptOrigin = new URL(global.document?.currentScript?.src || "").origin;
      if (scriptOrigin && scriptOrigin !== "null") return scriptOrigin;
    } catch (_error) {}
    var h = global.location?.hostname;
    if (h === "localhost" || h === "127.0.0.1") return global.location.origin;
    return "https://vibe.lumigrav.space";
  })();
  var STUN_HOST = (() => {
    var h;
    try {
      h = new URL(API).hostname;
    } catch (_error) {
      h = global.location?.hostname;
    }
    if (h === "localhost" || h === "127.0.0.1") return "localhost";
    return "vibeturn.lumigrav.space";
  })();
  var ICE_SERVERS = [
    { urls: ["stun:stun.l.google.com:19302"] },
    { urls: ["stun:stun.cloudflare.com:3478"] },
    { urls: [`stun:${STUN_HOST}:3478`] },
  ];
  var SIGNAL_POLL_FAST_COUNT = 8;
  var SIGNAL_POLL_FAST_MS = 100;
  var SIGNAL_POLL_ACTIVE_MS = 1000;
  var RELAY_HANDSHAKE_TIMEOUT_MS = 10000;
  var STREAM_QUALITY = 2;
  var STREAM_REALTIME = 3;
  var REALTIME_RELAY_LABEL = "relay-realtime";
  var CONNECTION_DIAGNOSTIC_HISTORY_LIMIT = 16;
  var CONNECTION_ICE_ERROR_LIMIT = 8;
  var HARD_MAX_CONNECTIONS = 16;
  var HARD_MAX_UPLOAD_BPS = 2 * 1024 * 1024;
  var DEFAULT_CONFIG = {
    heartbeatMs: 10000,
    maxConnections: 8,
    maxUploadBytesPerSecond: 512 * 1024,
    maxBufferedBytes: 1024 * 1024,
    maxTotalBufferedBytes: 4 * 1024 * 1024,
  };

  function randomId() {
    return (
      "r_" +
      Math.random().toString(36).slice(2, 10) +
      Math.random().toString(36).slice(2, 10)
    );
  }
  function clampInteger(value, fallback, minimum, maximum) {
    return Number.isSafeInteger(value)
      ? Math.min(maximum, Math.max(minimum, value))
      : fallback;
  }
  function strToBytes(value) {
    return new TextEncoder().encode(value);
  }
  function bytesToStr(value) {
    return new TextDecoder().decode(value);
  }

  // Wire v1/v2 都只读取路由所需字段；公共节点不解密 payload。
  function unpackWire(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 7) {
      throw new Error("invalid wire");
    }
    var view = new DataView(buffer);
    var bytes = new Uint8Array(buffer);
    if (bytes[0] === 0x56 && bytes[1] === 0x4e && bytes[2] === 2) {
      if (buffer.byteLength < 18) throw new Error("invalid wire v2");
      var fromLengthV2 = view.getUint8(14);
      var toLengthV2 = view.getUint8(15);
      var headerLengthV2 = 18 + fromLengthV2 + toLengthV2;
      if (headerLengthV2 > bytes.length) throw new Error("invalid wire v2 header");
      var payloadLengthV2 = view.getUint16(16);
      if (headerLengthV2 + payloadLengthV2 !== bytes.length) {
        throw new Error("invalid wire v2 length");
      }
      return {
        version: 2,
        flags: view.getUint8(3),
        epoch: view.getUint32(4),
        stream: view.getUint16(8),
        seq: view.getUint32(10),
        fromId: bytesToStr(bytes.subarray(18, 18 + fromLengthV2)),
        toId: bytesToStr(
          bytes.subarray(18 + fromLengthV2, 18 + fromLengthV2 + toLengthV2),
        ),
        payload: bytes.subarray(headerLengthV2),
      };
    }

    var fromLength = view.getUint8(2);
    var toLength = view.getUint8(3);
    var headerLength = 7 + fromLength + toLength;
    if (headerLength > bytes.length) throw new Error("invalid wire header");
    var payloadLength = view.getUint16(4 + fromLength + toLength);
    if (headerLength + payloadLength !== bytes.length) {
      throw new Error("invalid wire length");
    }
    return {
      version: 1,
      flags: view.getUint8(6 + fromLength + toLength),
      epoch: 0,
      stream: 0,
      seq: view.getUint16(0),
      fromId: bytesToStr(bytes.subarray(4, 4 + fromLength)),
      toId: bytesToStr(bytes.subarray(4 + fromLength, 4 + fromLength + toLength)),
      payload: bytes.subarray(headerLength),
    };
  }

  function packWire(wire, flags) {
    var fromBytes = strToBytes(wire.fromId);
    var toBytes = strToBytes(wire.toId);
    var payload =
      wire.payload instanceof Uint8Array ? wire.payload : new Uint8Array(wire.payload);
    if (fromBytes.length > 255 || toBytes.length > 255 || payload.length > 65535) {
      throw new Error("wire payload too large");
    }
    if (wire.version === 2) {
      var lengthV2 = 18 + fromBytes.length + toBytes.length + payload.length;
      var bufferV2 = new ArrayBuffer(lengthV2);
      var viewV2 = new DataView(bufferV2);
      var bytesV2 = new Uint8Array(bufferV2);
      bytesV2[0] = 0x56;
      bytesV2[1] = 0x4e;
      bytesV2[2] = 2;
      viewV2.setUint8(3, flags);
      viewV2.setUint32(4, wire.epoch);
      viewV2.setUint16(8, wire.stream);
      viewV2.setUint32(10, wire.seq);
      viewV2.setUint8(14, fromBytes.length);
      viewV2.setUint8(15, toBytes.length);
      viewV2.setUint16(16, payload.length);
      bytesV2.set(fromBytes, 18);
      bytesV2.set(toBytes, 18 + fromBytes.length);
      bytesV2.set(payload, 18 + fromBytes.length + toBytes.length);
      return bufferV2;
    }

    var length = 7 + fromBytes.length + toBytes.length + payload.length;
    var buffer = new ArrayBuffer(length);
    var view = new DataView(buffer);
    var bytes = new Uint8Array(buffer);
    view.setUint16(0, wire.seq);
    view.setUint8(2, fromBytes.length);
    view.setUint8(3, toBytes.length);
    bytes.set(fromBytes, 4);
    bytes.set(toBytes, 4 + fromBytes.length);
    view.setUint16(4 + fromBytes.length + toBytes.length, payload.length);
    view.setUint8(6 + fromBytes.length + toBytes.length, flags);
    bytes.set(payload, 7 + fromBytes.length + toBytes.length);
    return buffer;
  }

  var peerId = randomId();
  var peers = {};
  var connectionDiagnosticHistory = [];
  var cursor = 0;
  var fastPoll = SIGNAL_POLL_FAST_COUNT;
  var closed = false;
  var delegated = false;
  var delegatedStats = null;
  var delegationTimer = null;
  var delegationMessageHandler = null;
  var relayToken = null;
  var activeLockResolve = null;
  var lockRequestPending = false;
  var heartbeatTimer = null;
  var pollTimer = null;
  var polling = false;
  var retryTimer = null;
  var config = Object.assign({}, DEFAULT_CONFIG);

  function candidateType(candidate) {
    if (!candidate) return null;
    if (typeof candidate.type === "string" && candidate.type) return candidate.type;
    var raw = typeof candidate.candidate === "string" ? candidate.candidate : "";
    var match = /\btyp\s+([a-z0-9]+)/i.exec(raw);
    return match ? match[1].toLowerCase() : null;
  }

  function rememberCandidateType(entry, bucket, candidate) {
    var type = candidateType(candidate);
    if (!type || entry[bucket].includes(type)) return;
    entry[bucket].push(type);
  }

  function rememberDescriptionCandidateTypes(entry, bucket, description) {
    var sdp = typeof description?.sdp === "string" ? description.sdp : "";
    var matches = sdp.matchAll(/\btyp\s+([a-z0-9]+)/gi);
    for (var match of matches) rememberCandidateType(entry, bucket, { type: match[1] });
  }

  function connectionDiagnostic(entry, reason) {
    return {
      reason: reason || "active",
      startedAt: new Date(entry.connectStartedAt).toISOString(),
      open: !!entry.open,
      connectionState: entry.pc?.connectionState || null,
      signalingState: entry.pc?.signalingState || null,
      iceConnectionState: entry.pc?.iceConnectionState || null,
      iceGatheringState: entry.pc?.iceGatheringState || null,
      dataChannelState: entry.dc?.readyState || null,
      realtimeDataChannelState: entry.rtDc?.readyState || null,
      reliableBufferedAmount: Math.max(0, entry.dc?.bufferedAmount || 0),
      realtimeBufferedAmount: Math.max(0, entry.rtDc?.bufferedAmount || 0),
      realtimeDropped: Math.max(0, entry.realtimeDropped || 0),
      localCandidateTypes: entry.localCandidateTypes.slice(),
      remoteCandidateTypes: entry.remoteCandidateTypes.slice(),
      iceErrors: entry.iceErrors.map((error) => ({ ...error })),
    };
  }

  function cloneConnectionDiagnostics(value) {
    return {
      active: Array.isArray(value?.active)
        ? value.active.map((entry) => ({
            ...entry,
            localCandidateTypes: Array.isArray(entry.localCandidateTypes)
              ? entry.localCandidateTypes.slice()
              : [],
            remoteCandidateTypes: Array.isArray(entry.remoteCandidateTypes)
              ? entry.remoteCandidateTypes.slice()
              : [],
            iceErrors: Array.isArray(entry.iceErrors)
              ? entry.iceErrors.map((error) => ({ ...error }))
              : [],
          }))
        : [],
      recent: Array.isArray(value?.recent)
        ? value.recent.map((entry) => ({
            ...entry,
            localCandidateTypes: Array.isArray(entry.localCandidateTypes)
              ? entry.localCandidateTypes.slice()
              : [],
            remoteCandidateTypes: Array.isArray(entry.remoteCandidateTypes)
              ? entry.remoteCandidateTypes.slice()
              : [],
            iceErrors: Array.isArray(entry.iceErrors)
              ? entry.iceErrors.map((error) => ({ ...error }))
              : [],
          }))
        : [],
    };
  }

  function connectionDiagnosticsSnapshot() {
    return {
      active: Object.values(peers).map((entry) => connectionDiagnostic(entry, "active")),
      recent: connectionDiagnosticHistory.map((entry) => ({
        ...entry,
        localCandidateTypes: entry.localCandidateTypes.slice(),
        remoteCandidateTypes: entry.remoteCandidateTypes.slice(),
        iceErrors: entry.iceErrors.map((error) => ({ ...error })),
      })),
    };
  }
  var uploadWindowStartedAt = Date.now();
  var uploadWindowBytes = 0;
  var previousUploadBps = 0;
  var recentWires = {};
  var recentWireOrder = [];
  var RECENT_WIRE_TTL_MS = 10000;
  var RECENT_WIRE_LIMIT = 2048;

  function connectionKey(workId, roomId, remoteId) {
    return workId + "\0" + roomId + "\0" + remoteId;
  }
  function activeConnectionCount() {
    return Object.keys(peers).length;
  }
  function totalBufferedAmount() {
    var total = 0;
    for (var key in peers) {
      total += Math.max(0, peers[key]?.dc?.bufferedAmount || 0);
      total += Math.max(0, peers[key]?.rtDc?.bufferedAmount || 0);
    }
    return total;
  }
  function resetUploadWindow(now) {
    if (now - uploadWindowStartedAt < 1000) return;
    previousUploadBps = uploadWindowBytes;
    uploadWindowBytes = 0;
    uploadWindowStartedAt = now;
  }
  function wireFingerprint(wire) {
    var hashA = 2166136261;
    var hashB = 2654435769;
    var identity =
      wire.fromId + "\0" + wire.toId + "\0" + wire.epoch + "\0" + wire.stream +
      "\0" + wire.seq + "\0" + (wire.flags & ~6);
    for (var index = 0; index < identity.length; index++) {
      var identityByte = identity.charCodeAt(index);
      hashA ^= identityByte;
      hashA = Math.imul(hashA, 16777619);
      hashB ^= identityByte;
      hashB = Math.imul(hashB, 2246822519);
    }
    for (var payloadIndex = 0; payloadIndex < wire.payload.length; payloadIndex++) {
      var payloadByte = wire.payload[payloadIndex];
      hashA ^= payloadByte;
      hashA = Math.imul(hashA, 16777619);
      hashB ^= payloadByte;
      hashB = Math.imul(hashB, 2246822519);
    }
    return (
      wire.payload.length + ":" + (hashA >>> 0).toString(36) + ":" +
      (hashB >>> 0).toString(36)
    );
  }
  function pruneRecentWires(now) {
    while (recentWireOrder.length > 0) {
      var oldest = recentWireOrder[0];
      if (
        recentWireOrder.length <= RECENT_WIRE_LIMIT &&
        now - oldest.seenAt < RECENT_WIRE_TTL_MS
      ) {
        break;
      }
      recentWireOrder.shift();
      if (recentWires[oldest.fingerprint]?.seenAt === oldest.seenAt) {
        delete recentWires[oldest.fingerprint];
      }
    }
  }
  function wireAlreadySent(fingerprint, targetKey, now) {
    pruneRecentWires(now);
    var entry = recentWires[fingerprint];
    return !!(
      entry &&
      now - entry.seenAt < RECENT_WIRE_TTL_MS &&
      entry.targets[targetKey]
    );
  }
  function rememberWireTarget(fingerprint, targetKey, now) {
    pruneRecentWires(now);
    var entry = recentWires[fingerprint];
    if (!entry) {
      entry = { seenAt: now, targets: {} };
      recentWires[fingerprint] = entry;
      recentWireOrder.push({ fingerprint: fingerprint, seenAt: now });
    }
    entry.targets[targetKey] = true;
  }
  function nodeStats() {
    var now = Date.now();
    dropExpiredPeers(now);
    resetUploadWindow(now);
    var realtimeConnections = 0;
    var realtimeDropped = 0;
    for (var key in peers) {
      if (peers[key].rtOpen) realtimeConnections += 1;
      realtimeDropped += Math.max(0, peers[key].realtimeDropped || 0);
    }
    return {
      activeConnections: activeConnectionCount(),
      realtimeConnections: realtimeConnections,
      realtimeDropped: realtimeDropped,
      recentUploadBps: Math.max(previousUploadBps, uploadWindowBytes),
      bufferedBytes: totalBufferedAmount(),
      available:
        activeConnectionCount() < config.maxConnections &&
        Math.max(previousUploadBps, uploadWindowBytes) <
          config.maxUploadBytesPerSecond &&
        totalBufferedAmount() < config.maxTotalBufferedBytes,
    };
  }
  function applyConfig(next) {
    if (!next || typeof next !== "object") return;
    config.heartbeatMs = clampInteger(next.heartbeatMs, config.heartbeatMs, 5000, 30000);
    config.maxConnections = clampInteger(
      next.maxConnections,
      config.maxConnections,
      1,
      HARD_MAX_CONNECTIONS,
    );
    config.maxUploadBytesPerSecond = clampInteger(
      next.maxUploadBytesPerSecond,
      config.maxUploadBytesPerSecond,
      128 * 1024,
      HARD_MAX_UPLOAD_BPS,
    );
    config.maxBufferedBytes = clampInteger(
      next.maxBufferedBytes,
      config.maxBufferedBytes,
      256 * 1024,
      4 * 1024 * 1024,
    );
    config.maxTotalBufferedBytes = clampInteger(
      next.maxTotalBufferedBytes,
      config.maxTotalBufferedBytes,
      1024 * 1024,
      16 * 1024 * 1024,
    );
  }

  function apiFetch(path, init) {
    init = init || {};
    init.headers = Object.assign({}, init.headers, { "Content-Type": "application/json" });
    if (relayToken) init.headers.Authorization = "Relay " + relayToken;
    return fetch(API + path, init).then(async (response) => ({
      ok: response.ok,
      status: response.status,
      data: await response.json().catch(() => null),
    }));
  }

  function register() {
    return apiFetch("/api/relay/nodes", {
      method: "POST",
      body: JSON.stringify({ action: "register", peerId: peerId, stats: nodeStats() }),
    }).then((response) => {
      var result = response.data;
      if (!response.ok || !result?.ok) return false;
      if (result.enabled === false) {
        suspendForEmergency();
        return false;
      }
      relayToken = result.relayToken || relayToken;
      applyConfig(result.config);
      if (result.pendingSignal) wakeSignalPoll();
      scheduleHeartbeat();
      return true;
    });
  }

  function scheduleHeartbeat() {
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    if (closed) return;
    heartbeatTimer = setTimeout(heartbeat, config.heartbeatMs);
  }

  function heartbeat() {
    if (closed) return;
    apiFetch("/api/relay/nodes", {
      method: "POST",
      body: JSON.stringify({ action: "heartbeat", peerId: peerId, stats: nodeStats() }),
    })
      .then((response) => {
        if (response.status === 401) {
          restartAfterCapabilityLoss();
          return;
        }
        if (!response.ok) throw new Error("heartbeat failed");
        if (response.data?.enabled === false) {
          suspendForEmergency();
          scheduleRegistrationRetry();
          return;
        }
        relayToken = response.data?.relayToken || relayToken;
        applyConfig(response.data?.config);
        if (response.data?.pendingSignal) wakeSignalPoll();
        scheduleHeartbeat();
      })
      .catch(scheduleRegistrationRetry);
  }

  function unregister() {
    closed = true;
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    if (pollTimer) clearTimeout(pollTimer);
    if (retryTimer) clearTimeout(retryTimer);
    if (delegationTimer) clearInterval(delegationTimer);
    if (delegationMessageHandler) {
      global.removeEventListener("message", delegationMessageHandler);
    }
    heartbeatTimer = null;
    pollTimer = null;
    retryTimer = null;
    delegationTimer = null;
    delegationMessageHandler = null;
    polling = false;
    for (var key in peers) dropPeer(key, "unregister");
    if (relayToken) {
      apiFetch("/api/relay/nodes", {
        method: "POST",
        keepalive: true,
        body: JSON.stringify({ action: "unregister", peerId: peerId }),
      }).catch(() => {});
    }
    relayToken = null;
    if (activeLockResolve) {
      activeLockResolve();
      activeLockResolve = null;
    }
  }

  function suspendForEmergency() {
    relayToken = null;
    for (var key in peers) dropPeer(key, "emergency-disabled");
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  }

  function scheduleRegistrationRetry() {
    if (closed || retryTimer) return;
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      register()
        .then((active) => {
          if (!active) scheduleRegistrationRetry();
        })
        .catch(scheduleRegistrationRetry);
    }, 30000);
  }

  function restartAfterCapabilityLoss() {
    if (closed) return;
    relayToken = null;
    for (var key in peers) dropPeer(key, "capability-lost");
    peerId = randomId();
    cursor = 0;
    fastPoll = SIGNAL_POLL_FAST_COUNT;
    register()
      .then((active) => {
        if (!active) scheduleRegistrationRetry();
      })
      .catch(scheduleRegistrationRetry);
  }

  function hasUnsettledPeers() {
    dropExpiredPeers(Date.now());
    for (var key in peers) {
      var state = peers[key]?.pc?.connectionState;
      if (!peers[key]?.open || state === "new" || state === "connecting") return true;
    }
    return false;
  }
  function wakeSignalPoll() {
    if (closed) return;
    fastPoll = SIGNAL_POLL_FAST_COUNT;
    if (polling || pollTimer) return;
    pollTimer = setTimeout(poll, 0);
  }
  function poll() {
    if (closed) return;
    pollTimer = null;
    polling = true;
    var received = 0;
    apiFetch(`/api/relay/signal?peer=${encodeURIComponent(peerId)}&after=${cursor}`)
      .then((response) => {
        if (response.status === 401) {
          restartAfterCapabilityLoss();
          return;
        }
        var result = response.data;
        if (!result?.messages) return;
        received = result.messages.length;
        result.messages.forEach(handleSignal);
        if (Number.isSafeInteger(result.cursor) && result.cursor >= cursor) {
          cursor = result.cursor;
        }
      })
      .catch(() => {})
      .finally(() => {
        polling = false;
        if (closed) return;
        if (received > 0) fastPoll = SIGNAL_POLL_FAST_COUNT;
        if (fastPoll > 0) {
          fastPoll -= 1;
          pollTimer = setTimeout(poll, SIGNAL_POLL_FAST_MS);
        } else if (hasUnsettledPeers()) {
          pollTimer = setTimeout(poll, SIGNAL_POLL_ACTIVE_MS);
        }
      });
  }

  function handleSignal(message) {
    if (message.from === peerId || !message.work || !message.room) return;
    var key = connectionKey(message.work, message.room, message.from);
    if (message.kind === "leave-relay") {
      dropPeer(key, "leave-relay");
      return;
    }
    if (message.kind === "join-relay") {
      var grant = message.payload && message.payload.grant;
      if (typeof grant !== "string" || !grant) return;
      createRelayPeer(
        message.work,
        message.room,
        message.from,
        grant,
        message.payload?.realtime === 1 || message.payload?.realtime === true,
      );
      return;
    }
    var entry = peers[key];
    if (!entry) return;
    if (
      message.kind === "answer-relay" &&
      entry.pc.signalingState === "have-local-offer"
    ) {
      var answer = message.payload?.description || message.payload;
      rememberDescriptionCandidateTypes(entry, "remoteCandidateTypes", answer);
      entry.pc.setRemoteDescription(answer).catch(() => {});
    } else if (message.kind === "offer-relay") {
      var offer = message.payload?.description || message.payload;
      rememberDescriptionCandidateTypes(entry, "remoteCandidateTypes", offer);
      if (message.payload?.grant) entry.grant = message.payload.grant;
      if (message.payload?.realtime === 1 || message.payload?.realtime === true) {
        entry.realtimeCapable = true;
        ensureRealtimeChannel(
          connectionKey(entry.workId, entry.roomId, entry.remoteId),
          entry,
        );
      }
      Promise.resolve()
        .then(() => {
          if (entry.pc.signalingState !== "stable") {
            return entry.pc.setLocalDescription({ type: "rollback" });
          }
        })
        .then(() => entry.pc.setRemoteDescription(offer))
        .then(() => entry.pc.setLocalDescription())
        .then(() => {
          rememberDescriptionCandidateTypes(
            entry,
            "localCandidateTypes",
            entry.pc.localDescription,
          );
          return apiFetch("/api/relay/signal", {
            method: "POST",
            headers: { "X-Vibe-Relay-Grant": entry.grant },
            body: JSON.stringify({
              work: entry.workId,
              room: entry.roomId,
              from: peerId,
              to: entry.remoteId,
              kind: "answer-relay",
              payload: entry.pc.localDescription,
            }),
          });
        })
        .catch(() =>
          dropPeer(
            connectionKey(entry.workId, entry.roomId, entry.remoteId),
            "relay-answer-failed",
          ),
        );
    } else if (message.kind === "ice-relay") {
      rememberCandidateType(entry, "remoteCandidateTypes", message.payload);
      entry.pc.addIceCandidate(message.payload).catch(() => {});
    }
  }

  function createRelayPeer(workId, roomId, remoteId, grant, realtimeCapable) {
    var key = connectionKey(workId, roomId, remoteId);
    if (peers[key]) {
      peers[key].grant = grant;
      if (realtimeCapable) {
        peers[key].realtimeCapable = true;
        ensureRealtimeChannel(key, peers[key]);
      }
      return peers[key];
    }
    if (activeConnectionCount() >= config.maxConnections) return null;

    var pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    var entry = {
      pc: pc,
      dc: null,
      rtDc: null,
      open: false,
      rtOpen: false,
      realtimeCapable: !!realtimeCapable,
      realtimeDropped: 0,
      workId: workId,
      roomId: roomId,
      remoteId: remoteId,
      grant: grant,
      connectStartedAt: Date.now(),
      overloads: 0,
      localCandidateTypes: [],
      remoteCandidateTypes: [],
      iceErrors: [],
    };
    peers[key] = entry;
    pc.onicecandidate = (event) => {
      if (!event.candidate || peers[key] !== entry) return;
      rememberCandidateType(entry, "localCandidateTypes", event.candidate);
      apiFetch("/api/relay/signal", {
        method: "POST",
        headers: { "X-Vibe-Relay-Grant": grant },
        body: JSON.stringify({
          work: workId,
          room: roomId,
          from: peerId,
          to: remoteId,
          kind: "ice-relay",
          payload: event.candidate.toJSON(),
        }),
      }).catch(() => {});
    };
    pc.onicecandidateerror = (event) => {
      entry.iceErrors.push({
        at: new Date().toISOString(),
        errorCode: typeof event.errorCode === "number" ? event.errorCode : null,
        errorText:
          typeof event.errorText === "string" ? event.errorText.slice(0, 256) : "",
      });
      if (entry.iceErrors.length > CONNECTION_ICE_ERROR_LIMIT) entry.iceErrors.shift();
    };
    pc.onconnectionstatechange = () => {
      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "closed" ||
        pc.connectionState === "disconnected"
      ) {
        dropPeer(key, `connection-${pc.connectionState}`);
      }
    };
    entry.dc = pc.createDataChannel("relay");
    wireChannel(key, entry.dc, false);
    ensureRealtimeChannel(key, entry);
    pc.setLocalDescription()
      .then(() => {
        if (peers[key] !== entry) return;
        rememberDescriptionCandidateTypes(entry, "localCandidateTypes", pc.localDescription);
        return apiFetch("/api/relay/signal", {
          method: "POST",
          headers: { "X-Vibe-Relay-Grant": grant },
          body: JSON.stringify({
            work: workId,
            room: roomId,
            from: peerId,
            to: remoteId,
            kind: "offer-relay",
            payload: entry.realtimeCapable
              ? {
                  description: pc.localDescription,
                  realtime: 1,
                }
              : pc.localDescription,
          }),
        });
      })
      .catch(() => dropPeer(key, "relay-offer-failed"));
    return entry;
  }

  function ensureRealtimeChannel(key, entry) {
    if (!entry?.realtimeCapable || entry.rtDc || entry.pc?.connectionState === "closed") {
      return;
    }
    try {
      entry.rtDc = entry.pc.createDataChannel(REALTIME_RELAY_LABEL, {
        ordered: false,
        maxRetransmits: 0,
      });
      wireChannel(key, entry.rtDc, true);
    } catch (_error) {
      entry.rtDc = null;
    }
  }

  function wireChannel(key, dataChannel, realtime) {
    dataChannel.binaryType = "arraybuffer";
    dataChannel.onopen = () => {
      if (!peers[key]) return;
      if (realtime) peers[key].rtOpen = true;
      else peers[key].open = true;
    };
    dataChannel.onclose = () => {
      var entry = peers[key];
      if (realtime) {
        if (entry && entry.rtDc === dataChannel) {
          entry.rtOpen = false;
          entry.rtDc = null;
          ensureRealtimeChannel(key, entry);
        }
        return;
      }
      dropPeer(key, "data-channel-closed");
    };
    dataChannel.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      try {
        handleWireMessage(key, unpackWire(event.data));
      } catch (_error) {}
    };
  }

  function sendPacket(key, packet, realtime) {
    var target = peers[key];
    if (!target?.open || !target.dc) return false;
    var dataChannel =
      realtime && target.realtimeCapable && target.rtOpen && target.rtDc
        ? target.rtDc
        : target.dc;
    if (
      dataChannel.bufferedAmount + packet.byteLength > config.maxBufferedBytes ||
      totalBufferedAmount() + packet.byteLength > config.maxTotalBufferedBytes
    ) {
      if (realtime) {
        target.realtimeDropped += 1;
        return false;
      }
      target.overloads += 1;
      if (target.overloads >= 3) dropPeer(key, "buffer-overload");
      return false;
    }
    resetUploadWindow(Date.now());
    if (uploadWindowBytes + packet.byteLength > config.maxUploadBytesPerSecond) {
      if (realtime) {
        target.realtimeDropped += 1;
        return false;
      }
      target.overloads += 1;
      if (target.overloads >= 3) dropPeer(key, "upload-overload");
      return false;
    }
    try {
      dataChannel.send(packet);
      target.overloads = 0;
      uploadWindowBytes += packet.byteLength;
      return true;
    } catch (_error) {
      dropPeer(key, "data-channel-send-failed");
      return false;
    }
  }

  function handleWireMessage(fromKey, wire) {
    var source = peers[fromKey];
    if (!source) return;

    if (
      (wire.flags & 8) &&
      wire.toId === wire.fromId &&
      wire.payload?.length === 1
    ) {
      sendPacket(
        fromKey,
        packWire(
          {
            version: wire.version,
            fromId: peerId,
            toId: wire.fromId,
            epoch: wire.epoch,
            stream: wire.stream,
            seq: wire.seq,
            payload: new Uint8Array([2]),
          },
          1 | 16,
        ),
        false,
      );
      return;
    }
    if (wire.toId === peerId) return;

    var currentHop = (wire.flags >> 1) & 3;
    if (currentHop >= 2) return;
    var hop = currentHop + 1;
    var forwardedFlags = (wire.flags & ~6) | 1 | (hop << 1);
    var packet = packWire(wire, forwardedFlags);
    var realtime = wire.stream === STREAM_REALTIME || wire.stream === STREAM_QUALITY;
    var fingerprint = wireFingerprint(wire);
    var now = Date.now();
    rememberWireTarget(fingerprint, fromKey, now);
    var exactKey = connectionKey(source.workId, source.roomId, wire.toId);
    if (peers[exactKey]?.open) {
      if (wireAlreadySent(fingerprint, exactKey, now)) return;
      if (sendPacket(exactKey, packet, realtime)) {
        rememberWireTarget(fingerprint, exactKey, now);
        return;
      }
    }

    // 广播和目标暂未连到本节点时，只在同一个授权 work + room 内转发。
    for (var key in peers) {
      if (key === fromKey || key === exactKey) continue;
      var target = peers[key];
      if (target.workId !== source.workId || target.roomId !== source.roomId) continue;
      if (wireAlreadySent(fingerprint, key, now)) continue;
      if (sendPacket(key, packet, realtime)) rememberWireTarget(fingerprint, key, now);
    }
  }

  function dropPeer(key, reason) {
    var entry = peers[key];
    if (!entry) return;
    connectionDiagnosticHistory.push(connectionDiagnostic(entry, reason || "dropped"));
    if (connectionDiagnosticHistory.length > CONNECTION_DIAGNOSTIC_HISTORY_LIMIT) {
      connectionDiagnosticHistory.splice(
        0,
        connectionDiagnosticHistory.length - CONNECTION_DIAGNOSTIC_HISTORY_LIMIT,
      );
    }
    delete peers[key];
    try {
      entry.pc.close();
    } catch (_error) {}
  }

  function dropExpiredPeers(now) {
    for (var key in peers) {
      var entry = peers[key];
      if (
        !entry?.open &&
        Number.isFinite(entry.connectStartedAt) &&
        now - entry.connectStartedAt >= RELAY_HANDSHAKE_TIMEOUT_MS
      ) {
        dropPeer(key, "handshake-timeout");
      }
    }
  }

  function becomeLeader() {
    closed = false;
    return register()
      .then((active) => {
        if (!active) scheduleRegistrationRetry();
      })
      .catch(scheduleRegistrationRetry);
  }

  function start() {
    if (delegated || activeLockResolve || lockRequestPending) return;
    closed = false;
    if (global.navigator?.locks) {
      lockRequestPending = true;
      global.navigator.locks
        .request(
          "vibehub-vibenet-global-contributor",
          { mode: "exclusive" },
          () => {
            lockRequestPending = false;
            if (closed) return;
            return new Promise((resolve) => {
              activeLockResolve = resolve;
              becomeLeader();
            });
          },
        )
        .catch(() => {
          lockRequestPending = false;
        });
      return;
    }
    becomeLeader();
  }

  function trustedContributorChildOrigin(origin) {
    if (origin === API) return true;
    try {
      var apiUrl = new URL(API);
      if (apiUrl.hostname === "vibe.lumigrav.space") {
        return origin === "https://vibeapps.lumigrav.space";
      }
      if (apiUrl.hostname === "localhost" || apiUrl.hostname === "127.0.0.1") {
        return /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin);
      }
    } catch (_error) {}
    return false;
  }

  function contributorStatsSnapshot() {
    if (delegated && delegatedStats) {
      return Object.assign({}, delegatedStats, {
        delegated: true,
        config: Object.assign({}, delegatedStats.config || {}),
        connectionDiagnostics: cloneConnectionDiagnostics(
          delegatedStats.connectionDiagnostics,
        ),
      });
    }
    var stats = nodeStats();
    return {
      peerId: peerId,
      active: !closed && !!relayToken,
      delegated: delegated,
      connections: activeConnectionCount(),
      realtimeConnections: stats.realtimeConnections,
      realtimeDropped: stats.realtimeDropped,
      uploadBps: stats.recentUploadBps,
      bufferedBytes: stats.bufferedBytes,
      config: Object.assign({}, config),
      connectionDiagnostics: connectionDiagnosticsSnapshot(),
    };
  }

  // 主站父页面托管 iframe 的贡献；只返回 Relay 公开运行状态，不传账号或房间授权。
  global.addEventListener("message", (event) => {
    if (
      global.top === global &&
      trustedContributorChildOrigin(event.origin) &&
      event.data?.type === "vibehub:vibenet-host-request" &&
      event.source
    ) {
      event.source.postMessage(
        {
          type: "vibehub:vibenet-host",
          nonce: event.data.nonce,
          stats: contributorStatsSnapshot(),
        },
        event.origin,
      );
    }
  });

  function startWithParentDelegation() {
    if (global.parent === global) {
      start();
      return;
    }
    var nonce = randomId();
    var settled = false;
    function requestParentStatus() {
      global.parent.postMessage(
        { type: "vibehub:vibenet-host-request", nonce: nonce },
        API,
      );
    }
    function onMessage(event) {
      if (
        event.source === global.parent &&
        event.origin === API &&
        event.data?.type === "vibehub:vibenet-host" &&
        event.data.nonce === nonce
      ) {
        delegatedStats =
          event.data.stats && typeof event.data.stats === "object"
            ? event.data.stats
            : delegatedStats;
        if (settled) return;
        settled = true;
        delegated = true;
        delegationTimer = setInterval(requestParentStatus, 3000);
      }
    }
    delegationMessageHandler = onMessage;
    global.addEventListener("message", onMessage);
    requestParentStatus();
    setTimeout(() => {
      if (!settled) {
        global.removeEventListener("message", onMessage);
        delegationMessageHandler = null;
        start();
      }
    }, 750);
  }

  global.__VibeHubVibeNetContributor = {
    version: 5,
    stats: contributorStatsSnapshot,
    _unpackWire: unpackWire,
    _packWire: packWire,
  };

  global.addEventListener("beforeunload", unregister);
  if (global.document?.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", startWithParentDelegation, {
      once: true,
    });
  } else {
    startWithParentDelegation();
  }
})(window);
