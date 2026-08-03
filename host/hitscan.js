// 命中判定：世界射线 + 玩家（身体/头部球体）+ 近战判定。

import { PHYS } from '../shared/constants.js';
import { rayAABB, raySphere, directionFromAngles, randomInCone } from '../shared/math.js';
import { computeShotDamage, applySpread } from '../shared/weapons.js';
import { damagePlayer, eyeHeight } from './player.js';

export function traceWorld(map, origin, dir, maxDist = 300) {
  let best = maxDist;
  for (const box of map.colliders) {
    const t = rayAABB(origin, dir, box.min, box.max);
    if (t < best) best = t;
  }
  return best;
}

export function rewindPlayers(room, shooter, time) {
  const rewound = new Map();
  for (const p of room.players.values()) {
    if (p === shooter) continue;
    const snap = p.history?.get(time);
    rewound.set(p, snap || { pos: p.pos, yaw: p.yaw, pitch: p.pitch, crouch: p.crouch, alive: p.alive });
  }
  return rewound;
}

export function raycastPlayers(room, shooter, origin, dir, maxDist, rewound = null, skip = null) {
  let hit = null;
  let best = maxDist;
  for (const p of room.players.values()) {
    if (p === shooter) continue;
    if (skip && skip.has(p.id)) continue;
    const snap = rewound?.get(p);
    const alive = snap ? snap.alive : p.alive;
    if (!alive) continue;
    const pos = snap ? snap.pos : p.pos;
    const crouch = snap ? snap.crouch : p.crouch;
    const h = crouch ? PHYS.CROUCH_H : PHYS.STAND_H;
    const bodyC = { x: pos.x, y: pos.y + h * 0.55, z: pos.z };
    const headC = { x: pos.x, y: pos.y + h * 0.88, z: pos.z };
    const tb = raySphere(origin, dir, bodyC, 0.42);
    const th = raySphere(origin, dir, headC, 0.23);
    if (th < best) {
      best = th;
      hit = { player: p, headshot: true, t: th };
    } else if (tb < best) {
      best = tb;
      hit = { player: p, headshot: false, t: tb };
    }
  }
  return hit;
}

export function performShot(room, shooter, def, opts = {}) {
  if (!shooter.alive) return null;
  const results = [];
  const rewound = opts.rewindTime != null ? rewindPlayers(room, shooter, opts.rewindTime) : null;
  if (def.melee) {
    const origin = { x: shooter.pos.x, y: eyeHeight(shooter), z: shooter.pos.z };
    const fwd = directionFromAngles(shooter.yaw, shooter.pitch);
    let best = { t: Infinity, target: null };
    for (const p of room.players.values()) {
      if (p === shooter) continue;
      const snap = rewound?.get(p);
      const alive = snap ? snap.alive : p.alive;
      if (!alive) continue;
      const pos = snap ? snap.pos : p.pos;
      const crouch = snap ? snap.crouch : p.crouch;
      const h = crouch ? PHYS.CROUCH_H : PHYS.STAND_H;
      const c = { x: pos.x, y: pos.y + h * 0.5, z: pos.z };
      const dx = c.x - origin.x;
      const dy = c.y - origin.y;
      const dz = c.z - origin.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > def.range) continue;
      const dot = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / (dist || 1);
      if (dot < Math.cos(0.95)) continue;
      if (dist < best.t) best = { t: dist, target: p };
    }
    if (best.target) {
      const dmg = computeShotDamage(def, { headshot: false, dist: best.t });
      const r = damagePlayer(room, shooter, best.target, dmg, { weapon: def.id, headshot: false, dist: best.t });
      results.push(r);
    }
    return results;
  }

  if (def.projectile === 'grenade') {
    throwGrenade(room, shooter);
    return results;
  }

  const pellets = def.pellets ?? 1;
  const origin = { x: shooter.pos.x, y: eyeHeight(shooter), z: shooter.pos.z };
  for (let i = 0; i < pellets; i++) {
    const base = directionFromAngles(shooter.yaw, shooter.pitch);
    const angle = applySpread(def, !!shooter.input?.ads, Math.random);
    const dir = angle > 0 ? randomInCone(base, angle, Math.random) : base;
    const tWorld = traceWorld(room.map, origin, dir);
    const hit = raycastPlayers(room, shooter, origin, dir, tWorld, rewound);
    if (!hit) continue;
    const dist = hit.t;
    const dmg = computeShotDamage(def, { headshot: hit.headshot, dist });
    const r = damagePlayer(room, shooter, hit.player, dmg, { weapon: def.id, headshot: hit.headshot, dist });
    results.push({ ...r, pos: {
      x: origin.x + dir.x * dist,
      y: origin.y + dir.y * dist,
      z: origin.z + dir.z * dist,
    } });
    // 穿透：能量步枪 / 磁轨步枪沿直线命中后续目标（仍被墙体阻挡）
    if (def.pierce) {
      const skip = new Set([hit.player.id]);
      for (let hop = 0; hop < 5; hop++) {
        const nextHit = raycastPlayers(room, shooter, origin, dir, tWorld, rewound, skip);
        if (!nextHit || nextHit.t >= tWorld - 0.01) break;
        skip.add(nextHit.player.id);
        const d2 = computeShotDamage(def, { headshot: nextHit.headshot, dist: nextHit.t });
        const r2 = damagePlayer(room, shooter, nextHit.player, d2, { weapon: def.id, headshot: nextHit.headshot, dist: nextHit.t });
        results.push({ ...r2, pos: {
          x: origin.x + dir.x * nextHit.t,
          y: origin.y + dir.y * nextHit.t,
          z: origin.z + dir.z * nextHit.t,
        } });
      }
    }
  }
  return results;
}

export function throwGrenade(room, shooter) {
  const fwd = directionFromAngles(shooter.yaw, shooter.pitch);
  const speed = 17;
  room.projectiles.push({
    id: `p${room.nextProjId++}`,
    owner: shooter.id,
    pos: { x: shooter.pos.x, y: eyeHeight(shooter) - 0.2, z: shooter.pos.z },
    vel: {
      x: fwd.x * speed + shooter.vel.x * 0.5,
      y: fwd.y * speed + 2.5,
      z: fwd.z * speed + shooter.vel.z * 0.5,
    },
    fuse: 3.4,
    bounces: 0,
    kind: 'grenade',
  });
  room.broadcast({ type: 'throw', id: shooter.id, pos: room.projectiles.at(-1).pos });
}
