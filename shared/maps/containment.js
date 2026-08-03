// Containment：原创生化模式地图（中央实验室 + 走廊 + 掩体群）。

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
  id: 'containment',
  name: 'Containment 实验室',
  mode: 'zombie',
  size: { x: 56, z: 56 },
  sky: { top: 0x123b2a, bottom: 0x8fbca4, fog: 0x4e7d66 },
  spawns: {
    HUMAN: [
      { x: -24, z: -20, yaw: 0.6 },
      { x: -24, z: 20, yaw: -0.6 },
      { x: 24, z: -20, yaw: Math.PI - 0.6 },
      { x: 24, z: 20, yaw: Math.PI + 0.6 },
      { x: -18, z: 0, yaw: 1.2 },
      { x: 18, z: 0, yaw: -1.2 },
      { x: 0, z: -22, yaw: 0.3 },
      { x: 0, z: 22, yaw: -0.3 },
      { x: -12, z: -24, yaw: 0.8 },
      { x: 12, z: 24, yaw: -0.8 },
      { x: -12, z: 24, yaw: -1.4 },
      { x: 12, z: -24, yaw: 1.4 },
    ],
    ZOMBIE: [
      { x: 0, z: 0, yaw: 2.5 },      // 中央室内
      { x: 0, z: -4.5, yaw: 0 },     // 北门通道
      { x: 4.5, z: 0, yaw: -1.5 },   // 东门通道
      { x: -4.5, z: 0, yaw: 1.5 },   // 西门通道
    ],
  },
  sites: [],
  ammoBoxes: [
    { pos: { x: -24, z: -20 }, respawn: 20 },
    { pos: { x: -24, z: 20 }, respawn: 20 },
    { pos: { x: 24, z: -20 }, respawn: 20 },
    { pos: { x: 24, z: 20 }, respawn: 20 },
    { pos: { x: 0, z: 0 }, respawn: 20 },
    { pos: { x: -14, z: 0 }, respawn: 20 },
    { pos: { x: 14, z: 0 }, respawn: 20 },
  ],
  healthBoxes: [
    { pos: { x: -18, z: -18 }, respawn: 25 },
    { pos: { x: -18, z: 18 }, respawn: 25 },
    { pos: { x: 18, z: -18 }, respawn: 25 },
    { pos: { x: 18, z: 18 }, respawn: 25 },
    { pos: { x: 0, z: 0 }, respawn: 25 },
  ],
  colliders: [
    // 边界
    W(-28, -28, 28, -27, 5),
    W(-28, 27, 28, 28, 5),
    W(-28, -28, -27, 28, 5),
    W(27, -28, 28, 28, 5),
    // 中央实验室（四门，每侧开口 x/z ∈ -3..3）
    W(-7, -7, -2, -3, 3.2),
    W(-7, 3, -2, 7, 3.2),
    W(2, -7, 7, -3, 3.2),
    W(2, 3, 7, 7, 3.2),
    W(-7, -7, -3, -2, 3.2),
    W(3, -7, 7, -2, 3.2),
    W(-7, 2, -3, 7, 3.2),
    W(3, 2, 7, 7, 3.2),
    // 开阔地立柱（原中央柱子在墙内，已挪出）
    CR(-12, 12, 1.1, 2.8, 'pillar'),
    CR(0, 20, 1.1, 2.8, 'pillar'),
    // 四角掩体群
    CR(-20, -20, 1.8, 1.4),
    CR(-20, -16, 1.8, 1.4),
    CR(-16, -20, 1.8, 1.4),
    CR(20, 20, 1.8, 1.4),
    CR(20, 16, 1.8, 1.4),
    CR(16, 20, 1.8, 1.4),
    CR(-20, 20, 1.8, 1.4),
    CR(-20, 16, 1.8, 1.4),
    CR(20, -20, 1.8, 1.4),
    CR(20, -16, 1.8, 1.4),
    // 走廊掩体
    CR(0, -16, 1.5, 1.3),
    CR(0, 16, 1.5, 1.3),
    CR(-16, 0, 1.5, 1.3),
    CR(16, 0, 1.5, 1.3),
    CR(0, -24, 1.4, 1.2),
    CR(0, 24, 1.4, 1.2),
    CR(-24, 0, 1.4, 1.2),
    CR(24, 0, 1.4, 1.2),
    CR(-8, -24, 1.2, 1.2),
    CR(8, 24, 1.2, 1.2),
    // 油桶
    CR(-24, -12, 1.0, 1.0, 'barrel'),
    CR(-24, 12, 1.0, 1.0, 'barrel'),
    CR(24, -12, 1.0, 1.0, 'barrel'),
    CR(24, 12, 1.0, 1.0, 'barrel'),
    CR(-18, -24, 1.0, 1.0, 'barrel'),
    CR(18, 24, 1.0, 1.0, 'barrel'),
  ],
  props: [
    { type: 'light', pos: { x: 0, y: 5, z: 0 }, color: 0xc9ffe0 },
    { type: 'light', pos: { x: -20, y: 5, z: -20 }, color: 0xc9ffe0 },
    { type: 'light', pos: { x: 20, y: 5, z: -20 }, color: 0xc9ffe0 },
    { type: 'light', pos: { x: -20, y: 5, z: 20 }, color: 0xc9ffe0 },
    { type: 'light', pos: { x: 20, y: 5, z: 20 }, color: 0xc9ffe0 },
    { type: 'light', pos: { x: 0, y: 5, z: -24 }, color: 0xc9ffe0 },
    { type: 'light', pos: { x: 0, y: 5, z: 24 }, color: 0xc9ffe0 },
    { type: 'light', pos: { x: -24, y: 5, z: 0 }, color: 0xc9ffe0 },
    { type: 'light', pos: { x: 24, y: 5, z: 0 }, color: 0xc9ffe0 },
  ],
  nav: [
    { x: -24, z: -20, links: [4, 5] },
    { x: -24, z: 20, links: [4, 5] },
    { x: 24, z: -20, links: [6, 7] },
    { x: 24, z: 20, links: [6, 7] },
    { x: -14, z: 0, links: [0, 1, 8, 11] },
    { x: -16, z: 12, links: [0, 1, 8, 11] },
    { x: 14, z: 0, links: [2, 3, 9, 10] },
    { x: 16, z: 12, links: [2, 3, 9, 10] },
    { x: 0, z: -14, links: [4, 5, 12, 13] },
    { x: 0, z: 14, links: [6, 7, 12, 13] },
    { x: -8, z: -8, links: [4, 8, 12] },
    { x: -8, z: 8, links: [5, 9, 13] },
    { x: 8, z: -8, links: [8, 10, 14] },
    { x: 8, z: 8, links: [9, 11, 15] },
    { x: 0, z: 0, links: [10, 11, 12, 13, 16, 17] },
    { x: 12, z: 12, links: [13, 17] },
    { x: -12, z: -12, links: [14, 10] },
    { x: 12, z: -12, links: [14, 12] },
  ],
};
