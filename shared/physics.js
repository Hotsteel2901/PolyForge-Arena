// 玩家移动积分：服务器权威 + 客户端预测共用。

import { PHYS } from './constants.js';
import { resolveOverlap, aabbOverlap } from './math.js';

export function movePlayer(p, input, dt, colliders) {
  const speedBase = p.speedOverride ?? (p.isZombie ? PHYS.ZOMBIE_SPEED : PHYS.SPEED * (p.weaponMoveMult ?? 1));
  let speed = speedBase;
  if (p.isZombie && p.slowTicks > 0) speed *= PHYS.ZOMBIE_SLOW_MULT;
  if (input.s && !p.isZombie && !p.crouch && input.mv[0]) speed *= PHYS.SPRINT_MULT;
  if (p.crouch && !p.isZombie) speed *= PHYS.CROUCH_MULT;

  const f = (input.mv[0] ? 1 : 0) - (input.mv[1] ? 1 : 0);
  const s = (input.mv[3] ? 1 : 0) - (input.mv[2] ? 1 : 0);
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const rx = -fz;
  const rz = fx;
  let wx = fx * f + rx * s;
  let wz = fz * f + rz * s;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) {
    wx = (wx / wl) * speed;
    wz = (wz / wl) * speed;
  }

  const accel = Math.min(1, dt * (p.isZombie ? 14 : 11));
  p.vel.x += (wx - p.vel.x) * accel;
  p.vel.z += (wz - p.vel.z) * accel;

  // 垂直：接地且未跳跃时速度归零；跳跃立刻离地；只有空中才受重力
  if (p.grounded) {
    if (input.j) {
      p.vel.y = p.isZombie ? PHYS.ZOMBIE_JUMP : PHYS.JUMP;
      p.grounded = false;
    } else {
      p.vel.y = 0;
    }
  } else {
    p.vel.y += PHYS.GRAVITY * dt;
  }
  if (p.vel.y < PHYS.TERMINAL) p.vel.y = PHYS.TERMINAL;

  const height = p.crouch ? PHYS.CROUCH_H : PHYS.STAND_H;

  // 位置积分：每 tick 只推进一次（防止位移被碰撞箱数量放大）
  p.pos.x += p.vel.x * dt;
  p.pos.y += p.vel.y * dt;
  p.pos.z += p.vel.z * dt;

  // 自动台阶：积分后脚底被 0.4m 以下障碍挡住，但抬高后可通行时自动上台阶。
  // 放在积分之后，保证抬脚后立刻落在下一级顶面，支撑检测可持续接地。
  if (p.grounded && (Math.abs(p.vel.x) > 0.5 || Math.abs(p.vel.z) > 0.5)) {
    const STEP = 0.4;
    const curMin = { x: p.pos.x - PHYS.HALF, y: p.pos.y, z: p.pos.z - PHYS.HALF };
    const curMax = { x: p.pos.x + PHYS.HALF, y: p.pos.y + height, z: p.pos.z + PHYS.HALF };
    const newMin = { x: p.pos.x - PHYS.HALF, y: p.pos.y + STEP, z: p.pos.z - PHYS.HALF };
    const newMax = { x: p.pos.x + PHYS.HALF, y: p.pos.y + STEP + height, z: p.pos.z + PHYS.HALF };
    let curBlocked = false;
    let newBlocked = false;
    // 用 2cm 容差做重叠判定，避免 0.4 累加的浮点误差把“刚好站上台阶”误判为撞墙
    const overlap = (aMin, aMax, bMin, bMax) =>
      aMin.x < bMax.x - 0.02 && aMax.x > bMin.x + 0.02 &&
      aMin.y < bMax.y - 0.02 && aMax.y > bMin.y + 0.02 &&
      aMin.z < bMax.z - 0.02 && aMax.z > bMin.z + 0.02;
    for (const box of colliders) {
      if (overlap(curMin, curMax, box.min, box.max)) curBlocked = true;
      if (overlap(newMin, newMax, box.min, box.max)) newBlocked = true;
    }
    if (curBlocked && !newBlocked) p.pos.y += STEP;
  }

  let grounded = false;
  const half = PHYS.HALF;
  for (let pass = 0; pass < 2; pass++) {
    for (const box of colliders) {
      const r = resolveOverlap(p.pos, p.vel, half, height, box);
      if (r.grounded) grounded = true;
      // 支撑检测：脚底贴合碰撞体顶面视为站立
      if (
        Math.abs(p.pos.y - box.max.y) < 0.06 &&
        p.pos.x + half > box.min.x && p.pos.x - half < box.max.x &&
        p.pos.z + half > box.min.z && p.pos.z - half < box.max.z
      ) {
        grounded = true;
      }
    }
  }
  // 地图地面安全网：任何情况下不允许穿透 y=0（地面是隐式碰撞面）
  if (p.pos.y <= 0 && p.vel.y <= 0) {
    p.pos.y = 0;
    p.vel.y = 0;
    grounded = true;
  }
  p.grounded = grounded;
}
