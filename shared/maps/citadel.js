// Citadel：赛博要塞 —— 霓虹夜景三路立体地图（高架天桥 + 两侧狙击阁楼 + A/B 反应堆点位）。

const W = (x1, z1, x2, z2, h = 4.2, y = 0, type = 'wall') => ({
  min: { x: Math.min(x1, x2), y, z: Math.min(z1, z2) },
  max: { x: Math.max(x1, x2), y: y + h, z: Math.max(z1, z2) },
  type,
});

const CR = (x, z, s = 1.4, h = 1.5, y = 0, type = 'crate') => ({
  min: { x: x - s / 2, y, z: z - s / 2 },
  max: { x: x + s / 2, y: y + h, z: z + s / 2 },
  type,
});

export default {
  id: 'citadel',
  name: 'Citadel 赛博要塞',
  mode: 'defusal',
  size: { x: 68, z: 64 },
  sky: { top: 0x070d1f, bottom: 0x1b3358, fog: 0x12223d, near: 26, far: 165 },
  floorColor: 0x263142,
  wallColor: 0x3b4a61,
  lighting: { hemi: 1.05, sun: 1.85, ambient: 0.16, sunColor: 0xaad4ff },
  spawns: {
    CT: [
      { x: -29, z: -10, yaw: -Math.PI / 2 },
      { x: -29, z: 10, yaw: -Math.PI / 2 },
      { x: -26, z: -4, yaw: -Math.PI / 2 },
      { x: -26, z: 4, yaw: -Math.PI / 2 },
      { x: -29, z: 0, yaw: -Math.PI / 2 },
      { x: -27, z: -14, yaw: -Math.PI / 2 },
    ],
    T: [
      { x: 29, z: -10, yaw: Math.PI / 2 },
      { x: 29, z: 10, yaw: Math.PI / 2 },
      { x: 26, z: -4, yaw: Math.PI / 2 },
      { x: 26, z: 4, yaw: Math.PI / 2 },
      { x: 29, z: 0, yaw: Math.PI / 2 },
      { x: 27, z: 14, yaw: Math.PI / 2 },
    ],
  },
  sites: [
    { id: 'A', pos: { x: -13, y: 0, z: -16 }, radius: 3.0, color: 0x3ad8ff },
    { id: 'B', pos: { x: 13, y: 0, z: 16 }, radius: 3.0, color: 0xff5a6e },
  ],
  ammoBoxes: [
    { pos: { x: 0, y: 3.2, z: 0 }, respawn: 25 },
    { pos: { x: -22, y: 0, z: 18 }, respawn: 25 },
    { pos: { x: 22, y: 0, z: -18 }, respawn: 25 },
  ],
  healthBoxes: [
    { pos: { x: -14, y: 0, z: 14 }, respawn: 30 },
    { pos: { x: 14, y: 0, z: -14 }, respawn: 30 },
  ],
  colliders: [
    // 四周高墙边界
    W(-34, -32, 34, -31, 6),
    W(-34, 31, 34, 32, 6),
    W(-34, -32, -33, 32, 6),
    W(33, -32, 34, 32, 6),

    // 中央立体高架天桥（y=3.0）及两侧阶梯
    W(-7, -3.2, 7, 3.2, 0.32, 2.9, 'platform'),
    // 西侧上桥阶梯
    W(-10.5, -2.5, -7, 2.5, 0.75, 0, 'step'),
    W(-9.5, -2.5, -7, 2.5, 0.75, 0.75, 'step'),
    W(-8.5, -2.5, -7, 2.5, 0.75, 1.5, 'step'),
    W(-7.8, -2.5, -7, 2.5, 0.65, 2.25, 'step'),
    // 东侧上桥阶梯
    W(7, -2.5, 10.5, 2.5, 0.75, 0, 'step'),
    W(7, -2.5, 9.5, 2.5, 0.75, 0.75, 'step'),
    W(7, -2.5, 8.5, 2.5, 0.75, 1.5, 'step'),
    W(7, -2.5, 7.8, 2.5, 0.65, 2.25, 'step'),
    // 天桥护栏掩体
    W(-5, -3.2, -1.5, -2.9, 1.1, 3.2, 'beam'),
    W(1.5, 2.9, 5, 3.2, 1.1, 3.2, 'beam'),
    // 桥墩
    CR(-5.5, -2.5, 1.0, 2.9, 0, 'pillar'),
    CR(5.5, 2.5, 1.0, 2.9, 0, 'pillar'),

    // A 点赛博反应堆建筑（西北）
    W(-20, -23, -6, -22, 4.5),
    W(-20, -10, -14, -9, 4.5),
    W(-9, -10, -6, -9, 4.5),
    W(-20, -23, -19, -14, 4.5),
    W(-7, -23, -6, -15, 4.5),
    CR(-13, -16, 1.8, 2.4, 0, 'pillar'),
    CR(-16, -13, 1.3, 1.5),
    CR(-10, -19, 1.4, 1.5),

    // B 点反应堆建筑（东南）
    W(6, 22, 20, 23, 4.5),
    W(14, 9, 20, 10, 4.5),
    W(6, 9, 9, 10, 4.5),
    W(19, 14, 20, 23, 4.5),
    W(6, 15, 7, 23, 4.5),
    CR(13, 16, 1.8, 2.4, 0, 'pillar'),
    CR(16, 13, 1.3, 1.5),
    CR(10, 19, 1.4, 1.5),

    // 中路战术掩体与隔断墙
    W(-1.2, -24, 1.2, -11, 3.2),
    W(-1.2, 11, 1.2, 24, 3.2),
    W(-22, -1.4, -15, 1.4, 2.2),
    W(15, -1.4, 22, 1.4, 2.2),

    // 战术木箱与油桶掩体
    CR(-16, 10, 1.6, 1.6),
    CR(-12, 16, 1.4, 1.4),
    CR(16, -10, 1.6, 1.6),
    CR(12, -16, 1.4, 1.4),
    CR(-4, -9, 1.4, 1.3),
    CR(4, 9, 1.4, 1.3),
    CR(-24, -18, 1.1, 1.2, 0, 'barrel'),
    CR(24, 18, 1.1, 1.2, 0, 'barrel'),
    CR(-8, 18, 1.1, 1.2, 0, 'barrel'),
    CR(8, -18, 1.1, 1.2, 0, 'barrel'),
  ],
  props: [
    { type: 'light', pos: { x: 0, y: 7, z: 0 }, color: 0x5ad7ff },
    { type: 'light', pos: { x: -13, y: 6, z: -16 }, color: 0x3ad8ff },
    { type: 'light', pos: { x: 13, y: 6, z: 16 }, color: 0xff6b82 },
    { type: 'light', pos: { x: -25, y: 5.5, z: 0 }, color: 0x99ccff },
    { type: 'light', pos: { x: 25, y: 5.5, z: 0 }, color: 0xffb380 },
    { type: 'light', pos: { x: -14, y: 5.5, z: 14 }, color: 0x7dffb0 },
    { type: 'light', pos: { x: 14, y: 5.5, z: -14 }, color: 0x7dffb0 },
  ],
  nav: [
    { x: -26, z: 0, links: [1, 2, 3] },
    { x: -14, z: -14, links: [0, 4] },
    { x: -14, z: 14, links: [0, 5] },
    { x: -11, z: 0, links: [0, 4, 5, 6] },
    { x: 0, z: -8, links: [1, 3, 7] },
    { x: 0, z: 8, links: [2, 3, 7] },
    { x: 0, z: 0, y: 3.2, links: [3, 7] },
    { x: 11, z: 0, links: [4, 5, 6, 8, 9] },
    { x: 14, z: 14, links: [7, 10] },
    { x: 14, z: -14, links: [7, 10] },
    { x: 26, z: 0, links: [7, 8, 9] },
  ],
};
