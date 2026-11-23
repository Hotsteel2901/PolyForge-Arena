// Sanctum：雪原圣殿 —— 冰雪对称竞技场，中央祭坛高台 + 四角狙击塔，适配据点争夺 / 瞬狙 / 个人混战 / 团队死斗。

const W = (x1, z1, x2, z2, h = 4, y = 0, type = 'wall') => ({
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
  id: 'sanctum',
  name: 'Sanctum 雪原圣殿',
  mode: 'tdm',
  size: { x: 64, z: 64 },
  sky: { top: 0x163864, bottom: 0xcbe8ff, fog: 0xaad4f5, near: 28, far: 170 },
  floorColor: 0xb9ccd9,
  wallColor: 0x7b93a8,
  lighting: { hemi: 1.15, sun: 2.45, ambient: 0.14, sunColor: 0xeaf6ff },
  spawns: {
    CT: [
      { x: -25, z: -20, yaw: -Math.PI / 4 },
      { x: -25, z: 20, yaw: -3 * Math.PI / 4 },
      { x: -26, z: 0, yaw: -Math.PI / 2 },
      { x: -18, z: -24, yaw: 0 },
      { x: -18, z: 24, yaw: Math.PI },
      { x: -24, z: -8, yaw: -Math.PI / 2 },
    ],
    T: [
      { x: 25, z: 20, yaw: 3 * Math.PI / 4 },
      { x: 25, z: -20, yaw: Math.PI / 4 },
      { x: 26, z: 0, yaw: Math.PI / 2 },
      { x: 18, z: 24, yaw: Math.PI },
      { x: 18, z: -24, yaw: 0 },
      { x: 24, z: 8, yaw: Math.PI / 2 },
    ],
  },
  sites: [
    { id: 'H', pos: { x: 0, y: 1.6, z: 0 }, radius: 5.5, color: 0x4ef0ff },
  ],
  ammoBoxes: [
    { pos: { x: -16, y: 0, z: 0 }, respawn: 22 },
    { pos: { x: 16, y: 0, z: 0 }, respawn: 22 },
    { pos: { x: 0, y: 0, z: -18 }, respawn: 22 },
    { pos: { x: 0, y: 0, z: 18 }, respawn: 22 },
  ],
  healthBoxes: [
    { pos: { x: -14, y: 0, z: -14 }, respawn: 25 },
    { pos: { x: 14, y: 0, z: 14 }, respawn: 25 },
    { pos: { x: -14, y: 0, z: 14 }, respawn: 25 },
    { pos: { x: 14, y: 0, z: -14 }, respawn: 25 },
  ],
  colliders: [
    // 边界雪墙
    W(-32, -32, 32, -31, 5.5),
    W(-32, 31, 32, 32, 5.5),
    W(-32, -32, -31, 32, 5.5),
    W(31, -32, 32, 32, 5.5),

    // 中央圣殿高台（据点争夺核心）
    W(-6.5, -6.5, 6.5, 6.5, 1.6, 0, 'platform'),
    // 四向阶梯
    W(-8.8, -2.4, -6.5, 2.4, 0.8, 0, 'step'),
    W(-7.6, -2.4, -6.5, 2.4, 0.8, 0.8, 'step'),
    W(6.5, -2.4, 8.8, 2.4, 0.8, 0, 'step'),
    W(6.5, -2.4, 7.6, 2.4, 0.8, 0.8, 'step'),
    W(-2.4, -8.8, 2.4, -6.5, 0.8, 0, 'step'),
    W(-2.4, -7.6, 2.4, -6.5, 0.8, 0.8, 'step'),
    W(-2.4, 6.5, 2.4, 8.8, 0.8, 0, 'step'),
    W(-2.4, 6.5, 2.4, 7.6, 0.8, 0.8, 'step'),

    // 圣殿四角石柱 + 矮墙掩体
    CR(-5.2, -5.2, 1.3, 4.8, 1.6, 'pillar'),
    CR(5.2, -5.2, 1.3, 4.8, 1.6, 'pillar'),
    CR(-5.2, 5.2, 1.3, 4.8, 1.6, 'pillar'),
    CR(5.2, 5.2, 1.3, 4.8, 1.6, 'pillar'),
    W(-3.5, -5.5, 3.5, -5.0, 1.1, 1.6, 'beam'),
    W(-3.5, 5.0, 3.5, 5.5, 1.1, 1.6, 'beam'),

    // 四角外围L型掩体墙
    W(-22, -16, -15, -14.8, 3.2),
    W(-16.2, -22, -15, -15, 3.2),
    W(15, 14.8, 22, 16, 3.2),
    W(15, 15, 16.2, 22, 3.2),
    W(-22, 14.8, -15, 16, 3.2),
    W(-16.2, 15, -15, 22, 3.2),
    W(15, -16, 22, -14.8, 3.2),
    W(15, -22, 16.2, -15, 3.2),

    // 中距离箱体与石柱掩体
    CR(-13, 0, 1.8, 1.8),
    CR(13, 0, 1.8, 1.8),
    CR(0, -13, 1.8, 1.8),
    CR(0, 13, 1.8, 1.8),
    CR(-20, -6, 1.4, 1.5),
    CR(-20, 6, 1.4, 1.5),
    CR(20, -6, 1.4, 1.5),
    CR(20, 6, 1.4, 1.5),
    CR(-8, -21, 1.5, 2.2, 0, 'pillar'),
    CR(8, 21, 1.5, 2.2, 0, 'pillar'),
  ],
  props: [
    { type: 'light', pos: { x: 0, y: 8, z: 0 }, color: 0x7ae8ff },
    { type: 'light', pos: { x: -18, y: 6, z: -18 }, color: 0xd8f0ff },
    { type: 'light', pos: { x: 18, y: 6, z: 18 }, color: 0xd8f0ff },
    { type: 'light', pos: { x: -18, y: 6, z: 18 }, color: 0x99d6ff },
    { type: 'light', pos: { x: 18, y: 6, z: -18 }, color: 0x99d6ff },
  ],
  nav: [
    { x: -24, z: 0, links: [1, 2, 4] },
    { x: -18, z: -18, links: [0, 3, 4] },
    { x: -18, z: 18, links: [0, 5, 4] },
    { x: 0, z: -18, links: [1, 6, 4] },
    { x: 0, z: 0, y: 1.6, links: [0, 1, 2, 3, 5, 6, 7, 8] },
    { x: 0, z: 18, links: [2, 7, 4] },
    { x: 18, z: -18, links: [3, 8, 4] },
    { x: 18, z: 18, links: [5, 8, 4] },
    { x: 24, z: 0, links: [6, 7, 4] },
  ],
};
