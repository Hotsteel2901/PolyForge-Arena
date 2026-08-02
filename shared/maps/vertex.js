// Vertex：原创拆弹地图（A/B 双点），数据同时被服务器（碰撞）与客户端（渲染）使用。

const W = (x1, z1, x2, z2, h = 4, y = 0, type = 'wall') => ({
  min: { x: Math.min(x1, x2), y, z: Math.min(z1, z2) },
  max: { x: Math.max(x1, x2), y: y + h, z: Math.max(z1, z2) },
  type,
});

const CR = (x, z, s = 1.2, h = 1.4, type = 'crate') => ({
  min: { x: x - s / 2, y: 0, z: z - s / 2 },
  max: { x: x + s / 2, y: h, z: z + s / 2 },
  type,
});

export default {
  id: 'vertex',
  name: 'Vertex 拆弹基地',
  mode: 'defusal',
  size: { x: 60, z: 60 },
  sky: { top: 0x2b4f8f, bottom: 0xbcd7ee, fog: 0x9db9d4 },
  spawns: {
    CT: [
      { x: -25, z: -8, yaw: -Math.PI / 2 },
      { x: -25, z: 8, yaw: -Math.PI / 2 },
      { x: -22, z: -4, yaw: -Math.PI / 2 },
      { x: -22, z: 4, yaw: -Math.PI / 2 },
      { x: -25, z: 0, yaw: -Math.PI / 2 },
      { x: -24, z: 0, yaw: -Math.PI / 2 },
    ],
    T: [
      { x: 25, z: -8, yaw: Math.PI / 2 },
      { x: 25, z: 8, yaw: Math.PI / 2 },
      { x: 22, z: -4, yaw: Math.PI / 2 },
      { x: 22, z: 4, yaw: Math.PI / 2 },
      { x: 25, z: 0, yaw: Math.PI / 2 },
      { x: 24, z: 0, yaw: Math.PI / 2 },
    ],
  },
  sites: [
    { id: 'A', pos: { x: -12, y: 0, z: -10 }, radius: 2.6, color: 0xffcc33 },
    { id: 'B', pos: { x: 12, y: 0, z: 10 }, radius: 2.6, color: 0xffcc33 },
  ],
  colliders: [
    // 边界
    W(-30, -30, 30, -29, 5),
    W(-30, 29, 30, 30, 5),
    W(-30, -30, -29, 30, 5),
    W(29, -30, 30, 30, 5),
    // A 建筑（西北）
    W(-18, -16, -6, -15),
    W(-18, -5, -12, -4),
    W(-8, -5, -6, -4),
    W(-18, -16, -17, -4),
    W(-7, -16, -6, -4),
    // B 建筑（东南）
    W(6, 4, 12, 5),
    W(14, 4, 18, 5),
    W(6, 15, 18, 16),
    W(6, 4, 7, 16),
    W(17, 4, 18, 16),
    // 中路墙（留门）
    W(-1.2, -20, 1.2, -7, 2.5),
    W(-1.2, 7, 1.2, 20, 2.5),
    // 两侧掩体
    W(-22, -1.2, -16, 1.2, 2),
    W(16, -1.2, 22, 1.2, 2),
    // A 内箱子
    CR(-15, -8, 1.1, 1.5),
    CR(-10, -13, 1.4, 1.5),
    CR(-8, -7, 1.5, 1.4),
    CR(-16, -12, 0.9, 1.2),
    // B 内箱子
    CR(15, 8, 1.1, 1.5),
    CR(10, 13, 1.4, 1.5),
    CR(8, 7, 1.5, 1.4),
    CR(16, 12, 0.9, 1.2),
    // 中路箱子
    CR(0, 0, 2, 1.3),
    CR(-2.8, 2.8, 1.5, 1.2),
    CR(2.8, -2.8, 1.5, 1.2),
    CR(0, 3.6, 1.6, 1.1),
    CR(0, -3.6, 1.6, 1.1),
    CR(-6, 0, 1.2, 1.3),
    CR(6, 0, 1.2, 1.3),
    CR(0, 14, 1.4, 1.3),
    CR(0, -14, 1.4, 1.3),
    // 油桶（可作掩体）
    CR(-20, -14, 1.0, 1.0, 'barrel'),
    CR(-20, 14, 1.0, 1.0, 'barrel'),
    CR(20, -14, 1.0, 1.0, 'barrel'),
    CR(20, 14, 1.0, 1.0, 'barrel'),
    CR(-12, 16, 1.0, 1.0, 'barrel'),
    CR(12, -16, 1.0, 1.0, 'barrel'),
  ],
  props: [
    { type: 'light', pos: { x: -12, y: 5, z: -10 }, color: 0xfff2c0 },
    { type: 'light', pos: { x: 12, y: 5, z: 10 }, color: 0xfff2c0 },
    { type: 'light', pos: { x: 0, y: 5, z: 0 }, color: 0xfff2c0 },
    { type: 'light', pos: { x: -24, y: 5, z: 0 }, color: 0xccd9ff },
    { type: 'light', pos: { x: 24, y: 5, z: 0 }, color: 0xccd9ff },
    { type: 'light', pos: { x: 0, y: 5, z: -22 }, color: 0xccd9ff },
    { type: 'light', pos: { x: 0, y: 5, z: 22 }, color: 0xccd9ff },
  ],
  nav: [
    { x: -24, z: -8, links: [2, 3] },
    { x: -24, z: 8, links: [2, 3] },
    { x: -14, z: 0, links: [0, 1, 3, 6, 15] },
    { x: -10, z: -4.5, links: [2, 4] },
    { x: -12, z: -10, links: [3] },
    { x: 0, z: -6, links: [7, 14] },
    { x: 0, z: 6, links: [2, 7, 13] },
    { x: -3, z: 0, links: [5, 6, 8] },
    { x: 13, z: 4.5, links: [7, 9, 10] },
    { x: 12, z: 10, links: [8] },
    { x: 14, z: 0, links: [8, 11, 12] },
    { x: 24, z: -8, links: [10] },
    { x: 24, z: 8, links: [10] },
    { x: -4, z: 10, links: [6] },
    { x: 4, z: -10, links: [5, 10] },
    { x: -15, z: -1, links: [2] },
  ],
};
