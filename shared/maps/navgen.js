// 导航图自动生成：把碰撞体采样成可行走节点，再用短距离可见性连边。
// 手写 nav 图容易漏边（尤其是多层地图的楼梯、天桥），而 Bot 的寻路完全依赖它。
// 采样用与玩家一致的碰撞盒：站立空间（0.12m~1.72m）不被占用才算可站。
//
// 网格取 1.5m：2m 宽的门洞至少能落进一个采样点（2.5m 网格会漏门，导致
// 房间内部整体不可达 —— vertex 的 B 点、obsidian 的上层都踩过这个坑）。
// 台阶深仅 1m、每级 0.4m，网格必然跨级，所以额外为每个台阶面中心补点，
// 保证"地面→台阶→平台"是逐级 0.4m 的链，而不是 0.8m 的断路。

const RADIUS = 0.36;   // 玩家半宽（略大于 PHYS.HALF，留出贴墙余量）
const HEIGHT = 1.72;   // 站立高度（略小于 PHYS.STAND_H）
const GRID = 1.5;      // 采样间距
const LINK_DY = 0.45;  // 最大高差（台阶 0.4 可通行）

function overlaps(box, c) {
  return box.min.x < c.max.x - 0.02 && box.max.x > c.min.x + 0.02
    && box.min.y < c.max.y - 0.02 && box.max.y > c.min.y + 0.02
    && box.min.z < c.max.z - 0.02 && box.max.z > c.min.z + 0.02;
}

function standingFree(x, y, z, colliders) {
  const box = {
    min: { x: x - RADIUS, y: y + 0.12, z: z - RADIUS },
    max: { x: x + RADIUS, y: y + HEIGHT, z: z + RADIUS },
  };
  for (const c of colliders) if (overlaps(box, c)) return false;
  return true;
}

// 沿线段采样：每一步都要有站立空间，避免连出"穿墙边"。
// 高度统一取两端较高者 —— 上台阶时人是"先抬到上一级再前进"，
// 用两端插值会让身体在中途穿进台阶侧面，导致所有台阶边都连不上。
function walkClear(a, b, colliders) {
  const y = Math.max(a.y || 0, b.y || 0);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const steps = Math.max(2, Math.ceil(len / 0.7));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (!standingFree(a.x + dx * t, y, a.z + dz * t, colliders)) return false;
  }
  return true;
}

export function generateNav(map) {
  const colliders = map.colliders || [];
  if (!colliders.length) return [];
  const halfX = map.size.x / 2 - 1.2;
  const halfZ = map.size.z / 2 - 1.2;
  const nodes = [];
  const columns = new Map(); // "ix,iz" -> [node index...]

  const push = (x, y, z) => {
    const idx = nodes.length;
    nodes.push({ x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2), links: [] });
    const key = `${Math.round(x / GRID)},${Math.round(z / GRID)}`;
    if (!columns.has(key)) columns.set(key, []);
    columns.get(key).push(idx);
    return idx;
  };

  for (let x = -halfX; x <= halfX; x += GRID) {
    for (let z = -halfZ; z <= halfZ; z += GRID) {
      const levels = [0];
      for (const c of colliders) {
        // 只把"可走上去的构造"当作额外高度：墙顶/柱顶/箱顶 Bot 上不去，
        // 收进来只会产生一堆孤立节点，还会让寻路指向不可能的落点。
        if (c.type !== 'step' && c.type !== 'platform' && c.type !== 'floor') continue;
        const top = c.max.y;
        if (top <= 0.15 || top >= 4) continue;
        if (x > c.min.x - RADIUS && x < c.max.x + RADIUS
          && z > c.min.z - RADIUS && z < c.max.z + RADIUS) levels.push(top);
      }
      const uniq = [...new Set(levels.map((v) => +v.toFixed(2)))];
      for (const y of uniq) {
        if (!standingFree(x, y, z, colliders)) continue;
        push(x, y, z);
      }
    }
  }

  // 台阶 / 平台面中心补点：保证逐级 0.4m 的链存在
  for (const c of colliders) {
    if (c.type !== 'step' && c.type !== 'platform' && c.type !== 'floor') continue;
    const top = c.max.y;
    if (top <= 0.15 || top >= 4) continue;
    const cx = (c.min.x + c.max.x) / 2;
    const cz = (c.min.z + c.max.z) / 2;
    if (standingFree(cx, top, cz, colliders)) push(cx, top, cz);
  }

  // 只与相邻列（8 方向）连边，O(n) 而不是 O(n²)
  const near = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    const ix = Math.round(a.x / GRID);
    const iz = Math.round(a.z / GRID);
    for (const [dx, dz] of near) {
      const list = columns.get(`${ix + dx},${iz + dz}`);
      if (!list) continue;
      for (const j of list) {
        if (j === i) continue;
        const b = nodes[j];
        if (Math.abs(a.y - b.y) > LINK_DY) continue;
        if (Math.hypot(a.x - b.x, a.z - b.z) > GRID * 1.55) continue;
        if (a.links.includes(j)) continue;
        if (!walkClear(a, b, colliders)) continue;
        a.links.push(j);
        b.links.push(i);
      }
    }
  }

  // 剪掉孤立点并重映射索引（直接 filter 会让 links 指向错位）
  const keep = nodes.map((n) => n.links.length > 0);
  const remap = new Map();
  const out = [];
  nodes.forEach((n, i) => {
    if (!keep[i]) return;
    remap.set(i, out.length);
    out.push({ x: n.x, y: n.y, z: n.z, links: [] });
  });
  nodes.forEach((n, i) => {
    if (!keep[i]) return;
    const self = out[remap.get(i)];
    for (const j of n.links) if (keep[j]) self.links.push(remap.get(j));
    self.links = [...new Set(self.links)];
  });
  return out;
}
