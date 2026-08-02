// Obsidian 高塔：双层地图。A 点在底层广场，B 点在上层东平台，四边 8 级楼梯连接。

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

const CRY = (x, y, z, s = 1.2, h = 1.2, type = 'crate') => ({
  min: { x: x - s / 2, y, z: z - s / 2 },
  max: { x: x + s / 2, y: y + h, z: z + s / 2 },
  type,
});

const B = (x1, z1, x2, z2, y = 3, h = 0.2) => ({
  min: { x: Math.min(x1, x2), y, z: Math.min(z1, z2) },
  max: { x: Math.max(x1, x2), y: y + h, z: Math.max(z1, z2) },
  type: 'floor',
});

// 四组 8 级楼梯（每级高 0.4m，深 1m），自动台阶可步行上楼
const stairs = [];
for (let i = 0; i < 8; i++) {
  const y0 = 0.4 * i;
  stairs.push({ min: { x: -3, y: y0, z: -25 + i }, max: { x: 3, y: y0 + 0.4, z: -24 + i }, type: 'step' });
  stairs.push({ min: { x: -3, y: y0, z: 24 - i }, max: { x: 3, y: y0 + 0.4, z: 25 - i }, type: 'step' });
  stairs.push({ min: { x: -25 + i, y: y0, z: -3 }, max: { x: -24 + i, y: y0 + 0.4, z: 3 }, type: 'step' });
  stairs.push({ min: { x: 24 - i, y: y0, z: -3 }, max: { x: 25 - i, y: y0 + 0.4, z: 3 }, type: 'step' });
}

export default {
  id: 'obsidian',
  name: 'Obsidian 高塔',
  mode: 'defusal',
  size: { x: 52, z: 52 },
  sky: { top: 0x232b3a, bottom: 0x8b93a3, fog: 0x5c6472 },
  spawns: {
    CT: [
      { x: -22, z: -6, yaw: -Math.PI / 2 },
      { x: -22, z: 6, yaw: -Math.PI / 2 },
      { x: -22, z: -2, yaw: -Math.PI / 2 },
      { x: -22, z: 2, yaw: -Math.PI / 2 },
      { x: -24, z: 0, yaw: -Math.PI / 2 },
      { x: -20, z: 0, yaw: -Math.PI / 2 },
    ],
    T: [
      { x: 22, z: -6, yaw: Math.PI / 2 },
      { x: 22, z: 6, yaw: Math.PI / 2 },
      { x: 22, z: -2, yaw: Math.PI / 2 },
      { x: 22, z: 2, yaw: Math.PI / 2 },
      { x: 24, z: 0, yaw: Math.PI / 2 },
      { x: 20, z: 0, yaw: Math.PI / 2 },
    ],
    HUMAN: [
      { x: -20, z: -14, yaw: 0.7 },
      { x: -20, z: 14, yaw: -0.7 },
      { x: 20, z: -14, yaw: Math.PI - 0.7 },
      { x: 20, z: 14, yaw: Math.PI + 0.7 },
      { x: 0, z: -20, yaw: 0.3 },
      { x: 0, z: 20, yaw: -0.3 },
      { x: -14, z: 0, yaw: 1.2 },
      { x: 14, z: 0, yaw: -1.2 },
      { x: 0, z: -8, yaw: 0.5 },
      { x: 0, z: 8, yaw: -0.5 },
    ],
    ZOMBIE: [
      { x: 20, y: 3.2, z: 10, yaw: Math.PI },
      { x: -20, y: 3.2, z: -10, yaw: 0 },
      { x: 0, y: 3.2, z: 20, yaw: -1.5 },
      { x: 0, y: 3.2, z: -20, yaw: 1.5 },
    ],
  },
  sites: [
    { id: 'A', pos: { x: -10, y: 0, z: -8 }, radius: 2.8, color: 0xffcc33 },
    { id: 'B', pos: { x: 20, y: 3.2, z: 10 }, radius: 2.8, color: 0xffcc33 },
  ],
  ammoBoxes: [
    { pos: { x: -18, y: 0, z: -18 }, respawn: 20 },
    { pos: { x: -18, y: 0, z: 18 }, respawn: 20 },
    { pos: { x: 18, y: 0, z: -18 }, respawn: 20 },
    { pos: { x: 18, y: 0, z: 18 }, respawn: 20 },
    { pos: { x: 0, y: 0, z: 0 }, respawn: 20 },
    { pos: { x: 20, y: 3.2, z: 10 }, respawn: 20 },
    { pos: { x: -20, y: 3.2, z: -10 }, respawn: 20 },
    { pos: { x: 0, y: 3.2, z: 20 }, respawn: 20 },
    { pos: { x: 0, y: 3.2, z: -20 }, respawn: 20 },
  ],
  colliders: [
    // 边界
    W(-26, -26, 26, -25, 5),
    W(-26, 25, 26, 26, 5),
    W(-26, -26, -25, 26, 5),
    W(25, -26, 26, 26, 5),
    // 上层环形平台（留四个楼梯口）
    B(-26, -25, -3, -17),
    B(3, -25, 26, -17),
    B(-26, 17, -3, 25),
    B(3, 17, 26, 25),
    B(-25, -26, -17, -3),
    B(-25, 3, -17, 26),
    B(17, -26, 25, -3),
    B(17, 3, 25, 26),
    ...stairs,
    // 地面掩体
    CR(0, 0, 2, 1.3),
    CR(-3, -3, 1.5, 1.3),
    CR(3, 3, 1.5, 1.3),
    CR(-10, -22, 1.6, 1.2),
    CR(-22, -14, 1.6, 1.2),
    CR(22, 14, 1.6, 1.2),
    CR(10, 22, 1.6, 1.2),
    CR(-5, 5, 1.2, 1.2),
    CR(5, -5, 1.2, 1.2),
    CR(-10, 10, 1.2, 1.2),
    CR(10, -10, 1.2, 1.2),
    W(-12, -2, -8, 2, 1.6),
    W(8, -2, 12, 2, 1.6),
    // 中央立柱
    CR(-6, -6, 0.9, 2.6, 'pillar'),
    CR(6, 6, 0.9, 2.6, 'pillar'),
    CR(-6, 6, 0.9, 2.6, 'pillar'),
    CR(6, -6, 0.9, 2.6, 'pillar'),
    // 油桶
    CR(-18, 0, 1, 1, 'barrel'),
    CR(18, 0, 1, 1, 'barrel'),
    CR(-22, -20, 1, 1, 'barrel'),
    CR(22, 20, 1, 1, 'barrel'),
    CR(-22, 20, 1, 1, 'barrel'),
    CR(22, -20, 1, 1, 'barrel'),
    // 上层掩体
    CRY(18, 3.2, 6, 1.1, 1.1),
    CRY(22, 3.2, 14, 1.1, 1.1),
    CRY(-18, 3.2, -6, 1.1, 1.1),
    CRY(-22, 3.2, -14, 1.1, 1.1),
    CRY(-8, 3.2, 22, 1.2, 1.1),
    CRY(8, 3.2, -22, 1.2, 1.1),
    CRY(-6, 3.2, 18, 1.2, 1.1),
    CRY(6, 3.2, 18, 1.2, 1.1),
    CRY(-6, 3.2, -18, 1.2, 1.1),
    CRY(6, 3.2, -18, 1.2, 1.1),
  ],
  props: [
    { type: 'light', pos: { x: -10, y: 5, z: -8 }, color: 0xfff2c0 },
    { type: 'light', pos: { x: 20, y: 6.5, z: 10 }, color: 0xfff2c0 },
    { type: 'light', pos: { x: 0, y: 5, z: 0 }, color: 0xccd9ff },
    { type: 'light', pos: { x: -22, y: 5, z: 0 }, color: 0xccd9ff },
    { type: 'light', pos: { x: 22, y: 5, z: 0 }, color: 0xccd9ff },
    { type: 'light', pos: { x: 0, y: 5, z: -22 }, color: 0xccd9ff },
    { type: 'light', pos: { x: 0, y: 5, z: 22 }, color: 0xccd9ff },
    { type: 'light', pos: { x: -20, y: 6.5, z: -10 }, color: 0xfff2c0 },
  ],
  nav: [
    // 地面（y=0）
    { x: -24, z: -8, y: 0, links: [2, 10] },
    { x: -24, z: 8, y: 0, links: [2, 12] },
    { x: -14, z: 0, y: 0, links: [0, 1, 3, 9] },
    { x: -10, z: -8, y: 0, links: [2, 4, 10] },
    { x: 0, z: -14, y: 0, links: [3, 9, 13, 14] },
    { x: 0, z: 14, y: 0, links: [9, 12, 15] },
    { x: 14, z: 0, y: 0, links: [9, 11, 17] },
    { x: 24, z: -8, y: 0, links: [6, 13] },
    { x: 24, z: 8, y: 0, links: [6, 11] },
    { x: 0, z: -2, y: 0, links: [2, 4, 5, 6] },
    { x: -14, z: -14, y: 0, links: [0, 3, 16] },
    { x: 14, z: 14, y: 0, links: [6, 8, 15] },
    { x: -14, z: 14, y: 0, links: [1, 5, 16] },
    { x: 14, z: -14, y: 0, links: [4, 7, 14, 17] },
    // 楼梯底部
    { x: 0, z: -20, y: 0, links: [4, 13, 18] },
    { x: 0, z: 20, y: 0, links: [5, 11, 19] },
    { x: -20, z: 0, y: 0, links: [10, 12, 20] },
    { x: 20, z: 0, y: 0, links: [6, 13, 21] },
    // 楼梯顶部（y=3.2）
    { x: 0, z: -18.5, y: 3.2, links: [22, 23, 26] },
    { x: 0, z: 18.5, y: 3.2, links: [24, 25, 27] },
    { x: -18.5, z: 0, y: 3.2, links: [22, 24, 28] },
    { x: 18.5, z: 0, y: 3.2, links: [23, 25, 29] },
    // 上层平台
    { x: -20, z: -20, y: 3.2, links: [18, 20, 26, 28, 30] },
    { x: 20, z: -20, y: 3.2, links: [18, 21, 26, 29] },
    { x: -20, z: 20, y: 3.2, links: [19, 20, 27, 28] },
    { x: 20, z: 20, y: 3.2, links: [19, 21, 27, 29] },
    { x: 0, z: -20, y: 3.2, links: [18, 22, 23] },
    { x: 0, z: 20, y: 3.2, links: [19, 24, 25] },
    { x: -20, z: 0, y: 3.2, links: [20, 22, 24, 30] },
    { x: 20, z: 10, y: 3.2, links: [21, 23, 25] },
    { x: -20, z: -10, y: 3.2, links: [22, 28] },
  ],
};
