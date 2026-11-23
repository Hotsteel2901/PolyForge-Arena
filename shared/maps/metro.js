// Metro：地下铁枢纽 —— 室内霓虹地铁站，双列列车车厢掩体 + 双侧站台高地，适合生化 / 死斗 / 拆弹 / 军备。

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
  id: 'metro',
  name: 'Metro 地下铁枢纽',
  mode: 'zombie',
  size: { x: 66, z: 54 },
  sky: { top: 0x0d121c, bottom: 0x182230, fog: 0x151e2b, near: 18, far: 95 },
  floorColor: 0x3b414a,
  wallColor: 0x545d68,
  ceiling: { y: 7.5, color: 0x181f2a, emissive: 0x0a1018 },
  lighting: { hemi: 1.05, sun: 1.35, ambient: 0.22, sunColor: 0xffe4c4 },
  spawns: {
    CT: [
      { x: -28, z: -14, yaw: -Math.PI / 2 },
      { x: -28, z: 14, yaw: -Math.PI / 2 },
      { x: -28, z: 0, yaw: -Math.PI / 2 },
      { x: -24, z: -18, yaw: -Math.PI / 2 },
      { x: -24, z: 18, yaw: -Math.PI / 2 },
      { x: -26, z: 6, yaw: -Math.PI / 2 },
    ],
    T: [
      { x: 28, z: -14, yaw: Math.PI / 2 },
      { x: 28, z: 14, yaw: Math.PI / 2 },
      { x: 28, z: 0, yaw: Math.PI / 2 },
      { x: 24, z: -18, yaw: Math.PI / 2 },
      { x: 24, z: 18, yaw: Math.PI / 2 },
      { x: 26, z: -6, yaw: Math.PI / 2 },
    ],
  },
  sites: [
    { id: 'A', pos: { x: -12, y: 1.2, z: -18 }, radius: 2.8, color: 0xffaa33 },
    { id: 'B', pos: { x: 12, y: 1.2, z: 18 }, radius: 2.8, color: 0x4ef0ff },
  ],
  ammoBoxes: [
    { pos: { x: 0, y: 0, z: 0 }, respawn: 20 },
    { pos: { x: -16, y: 1.2, z: -18 }, respawn: 22 },
    { pos: { x: 16, y: 1.2, z: 18 }, respawn: 22 },
  ],
  healthBoxes: [
    { pos: { x: -16, y: 1.2, z: 18 }, respawn: 25 },
    { pos: { x: 16, y: 1.2, z: -18 }, respawn: 25 },
  ],
  colliders: [
    // 隧道四壁
    W(-33, -27, 33, -26, 7.5),
    W(-33, 26, 33, 27, 7.5),
    W(-33, -27, -32, 27, 7.5),
    W(32, -27, 33, 27, 7.5),

    // 南北双侧候车站台（y=1.2 高地）
    W(-22, -26, 22, -14, 1.2, 0, 'platform'),
    W(-22, 14, 22, 26, 1.2, 0, 'platform'),
    // 站台阶梯
    W(-24.2, -22, -22, -16, 0.6, 0, 'step'),
    W(22, -22, 24.2, -16, 0.6, 0, 'step'),
    W(-24.2, 16, -22, 22, 0.6, 0, 'step'),
    W(22, 16, 24.2, 22, 0.6, 0, 'step'),
    W(-3, -14, 3, -12.2, 0.6, 0, 'step'),
    W(-3, 12.2, 3, 14, 0.6, 0, 'step'),

    // 停靠的两列地铁车厢（中间留穿行过道）
    W(-20, -9, -4, -4.5, 2.9, 0, 'wall'),
    W(4, -9, 20, -4.5, 2.9, 0, 'wall'),
    W(-20, 4.5, -4, 9, 2.9, 0, 'wall'),
    W(4, 4.5, 20, 9, 2.9, 0, 'wall'),

    // 站台承重柱列
    CR(-16, -16, 1.2, 6.3, 1.2, 'pillar'),
    CR(0, -16, 1.2, 6.3, 1.2, 'pillar'),
    CR(16, -16, 1.2, 6.3, 1.2, 'pillar'),
    CR(-16, 16, 1.2, 6.3, 1.2, 'pillar'),
    CR(0, 16, 1.2, 6.3, 1.2, 'pillar'),
    CR(16, 16, 1.2, 6.3, 1.2, 'pillar'),

    // 中央铁轨掩体箱与油桶
    CR(-10, 0, 1.6, 1.4),
    CR(10, 0, 1.6, 1.4),
    CR(0, -2.5, 1.3, 1.3),
    CR(0, 2.5, 1.3, 1.3),
    CR(-25, 0, 1.2, 1.2, 0, 'barrel'),
    CR(25, 0, 1.2, 1.2, 0, 'barrel'),
    CR(-8, -21, 1.5, 1.4, 1.2, 'crate'),
    CR(8, 21, 1.5, 1.4, 1.2, 'crate'),
  ],
  props: [
    { type: 'light', pos: { x: -16, y: 6.2, z: -18 }, color: 0xffaa55 },
    { type: 'light', pos: { x: 16, y: 6.2, z: -18 }, color: 0xffaa55 },
    { type: 'light', pos: { x: -16, y: 6.2, z: 18 }, color: 0x5ad7ff },
    { type: 'light', pos: { x: 16, y: 6.2, z: 18 }, color: 0x5ad7ff },
    { type: 'light', pos: { x: 0, y: 6.2, z: 0 }, color: 0xe6f2ff },
    { type: 'light', pos: { x: -24, y: 5.5, z: 0 }, color: 0xff9966 },
    { type: 'light', pos: { x: 24, y: 5.5, z: 0 }, color: 0x66ccff },
  ],
  nav: [
    { x: -27, z: 0, links: [1, 2, 3] },
    { x: -12, z: -19, y: 1.2, links: [0, 4, 5] },
    { x: -12, z: 19, y: 1.2, links: [0, 4, 6] },
    { x: -12, z: 0, links: [0, 4] },
    { x: 0, z: 0, links: [1, 2, 3, 5, 6, 7] },
    { x: 12, z: -19, y: 1.2, links: [1, 4, 8] },
    { x: 12, z: 19, y: 1.2, links: [2, 4, 8] },
    { x: 12, z: 0, links: [4, 8] },
    { x: 27, z: 0, links: [5, 6, 7] },
  ],
};
