// 纯数学工具：射线、碰撞、护甲、伤害衰减。服务器与客户端共用。

export const EPS = 1e-6;

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function clampAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function angLerp(a, b, t) {
  return a + clampAngle(b - a) * t;
}

function axis(v, i) {
  return i === 0 ? v.x : i === 1 ? v.y : v.z;
}

export function raySphere(origin, dir, center, radius) {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const sq = Math.sqrt(disc);
  let t = -b - sq;
  if (t < 0) t = -b + sq;
  return t < 0 ? Infinity : t;
}

export function rayAABB(origin, dir, min, max) {
  let tmin = 0;
  let tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    const o = axis(origin, i);
    const d = axis(dir, i);
    const lo = axis(min, i);
    const hi = axis(max, i);
    if (Math.abs(d) < EPS) {
      if (o < lo || o > hi) return Infinity;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

export function aabbOverlap(aMin, aMax, bMin, bMax) {
  return (
    aMin.x < bMax.x && aMax.x > bMin.x &&
    aMin.y < bMax.y && aMax.y > bMin.y &&
    aMin.z < bMax.z && aMax.z > bMin.z
  );
}

// 玩家是 feet 位置 + half/height 的 AABB；逐轴移动并解算与 box 的碰撞。
export function resolveAABB(pos, vel, half, height, box, dt) {
  const p = { ...pos };
  const v = { ...vel };
  let grounded = false;
  for (let i = 0; i < 3; i++) {
    const a = i === 0 ? 'x' : i === 1 ? 'y' : 'z';
    if (Math.abs(v[a]) < EPS) continue;
    p[a] += v[a] * dt;
    const min = { x: p.x - half, y: p.y, z: p.z - half };
    const max = { x: p.x + half, y: p.y + height, z: p.z + half };
    if (aabbOverlap(min, max, box.min, box.max)) {
      if (a === 'x') {
        p.x = v.x > 0 ? box.min.x - half : box.max.x + half;
        v.x = 0;
      } else if (a === 'z') {
        p.z = v.z > 0 ? box.min.z - half : box.max.z + half;
        v.z = 0;
      } else {
        if (v.y < 0) {
          p.y = box.max.y;
          grounded = true;
        } else {
          p.y = box.min.y - height;
        }
        v.y = 0;
      }
    }
  }
  return { pos: p, vel: v, grounded };
}

// 只做重叠解算、不做位置积分（位置积分必须每帧只进行一次，否则位移会被碰撞箱数量放大）。
// 按最小穿透轴把玩家推出 box，并清零该轴速度；从上方落下时视为落地。
export function resolveOverlap(pos, vel, half, height, box) {
  const min = { x: pos.x - half, y: pos.y, z: pos.z - half };
  const max = { x: pos.x + half, y: pos.y + height, z: pos.z + half };
  if (!aabbOverlap(min, max, box.min, box.max)) return { grounded: false };
  // 脚底接近箱体顶面时优先纵向解算：站在掩体上不会被横向挤出
  if (pos.y >= box.max.y - 0.06) {
    pos.y = box.max.y;
    vel.y = 0;
    return { grounded: true };
  }
  const penX = Math.min(max.x - box.min.x, box.max.x - min.x);
  const penY = Math.min(max.y - box.min.y, box.max.y - min.y);
  const penZ = Math.min(max.z - box.min.z, box.max.z - min.z);
  let grounded = false;
  if (penY <= penX && penY <= penZ) {
    const above = pos.y + height / 2 > (box.min.y + box.max.y) / 2;
    if (above) {
      pos.y = box.max.y;
      grounded = true;
    } else {
      pos.y = box.min.y - height;
    }
    vel.y = 0;
  } else if (penX <= penZ) {
    pos.x = pos.x > (box.min.x + box.max.x) / 2 ? box.max.x + half : box.min.x - half;
    vel.x = 0;
  } else {
    pos.z = pos.z > (box.min.z + box.max.z) / 2 ? box.max.z + half : box.min.z - half;
    vel.z = 0;
  }
  return { grounded };
}

export function applyArmor(damage, armor) {
  const absorbed = Math.min(armor, damage * 0.5);
  return { damage: Math.max(0, damage - absorbed), armor: Math.max(0, armor - absorbed) };
}

export function damageFalloff(damage, dist, near, far, minMult = 0.5) {
  if (dist <= near) return damage;
  if (dist >= far) return damage * minMult;
  const t = (dist - near) / (far - near);
  return damage * (1 - t * (1 - minMult));
}

export function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.hypot(dx, dy, dz);
}

export function directionFromAngles(yaw, pitch) {
  const cp = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * cp,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cp,
  };
}

export function randomInCone(dir, angle, rng = Math.random) {
  // 在方向锥内随机扰动（简单近似：绕任意轴旋转 angle*rand）
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(rng()) * angle;
  const ox = Math.cos(a) * r;
  const oy = Math.sin(a) * r;
  const len = Math.hypot(dir.x, dir.y, dir.z);
  const n = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
  // 构造两个正交基向量
  let tx = 1;
  let ty = 0;
  let tz = 0;
  if (Math.abs(n.x) > 0.9) {
    tx = 0; tz = 1;
  }
  let bx = n.y * tz - n.z * ty;
  let by = n.z * tx - n.x * tz;
  let bz = n.x * ty - n.y * tx;
  const bl = Math.hypot(bx, by, bz) || 1;
  bx /= bl; by /= bl; bz /= bl;
  const cx = ty * bz - tz * by;
  const cy = tz * bx - tx * bz;
  const cz = tx * by - ty * bx;
  return {
    x: n.x + bx * ox + cx * oy,
    y: n.y + by * ox + cy * oy,
    z: n.z + bz * ox + cz * oy,
  };
}
