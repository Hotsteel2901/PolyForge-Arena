// Pit：竞技场式小型地图（44×44），为团队死斗 / 军备竞赛设计。
// 中心 1.2m 高台 + 四向三级台阶，形成"占高地换暴露"的对称争夺点；
// 外圈留出完整的环形跑动带，方便复活后快速接战，避免重生点被压。

const W = (x1, z1, x2, z2, h = 5, y = 0, type = 'wall') => ({
  min: { x: Math.min(x1, x2), y, z: Math.min(z1, z2) },
  max: { x: Math.max(x1, x2), y: y + h, z: Math.max(z1, z2) },
  type,
});

const CR = (x, z, s = 1.2, h = 1.4, type = 'crate') => ({
  min: { x: x - s / 2, y: 0, z: z - s / 2 },
  max: { x: x + s / 2, y: h, z: z + s / 2 },
  type,
});

// 中央高台
const PLATFORM_H = 1.2;
const platform = {
  min: { x: -3, y: 0, z: -3 },
  max: { x: 3, y: PLATFORM_H, z: 3 },
  type: 'floor',
};

// 四向台阶：每级 0.4m、深 1m，共三级（0.4 / 0.8 / 1.2）
const stairs = [];
for (let i = 0; i < 3; i++) {
  const h = 0.4 * (i + 1);
  stairs.push({ min: { x: -3, y: 0, z: -6 + i }, max: { x: 3, y: h, z: -5 + i }, type: 'step' });
  stairs.push({ min: { x: -3, y: 0, z: 5 - i }, max: { x: 3, y: h, z: 6 - i }, type: 'step' });
  stairs.push({ min: { x: -6 + i, y: 0, z: -3 }, max: { x: -5 + i, y: h, z: 3 }, type: 'step' });
  stairs.push({ min: { x: 5 - i, y: 0, z: -3 }, max: { x: 6 - i, y: h, z: 3 }, type: 'step' });
}

export default {
  id: 'pit',
  name: 'Pit 竞技场',
  mode: 'tdm',
  size: { x: 44, z: 44 },
  sky: { top: 0x1b2b3d, bottom: 0x9fc0da, fog: 0x8fa6bb, near: 20, far: 120 },
  floorColor: 0x5f6660,
  wallColor: 0x9aa3a8,
  ambient: 'outdoor',
  lighting: { ambient: 0.08, hemi: 0.9, sun: 2.3 },
  spawns: {
    // 朝向 = 面向场地中心：朝向公式 forward = (-sin yaw, -cos yaw)，
    // 北侧出生点要朝 +z（中心）→ yaw = π；南侧朝 -z → yaw = 0。
    CT: [
      { x: -5, z: -18, yaw: Math.PI },
      { x: 0, z: -18, yaw: Math.PI },
      { x: 5, z: -18, yaw: Math.PI },
      { x: -8, z: -16, yaw: Math.PI - 0.4 },
      { x: 8, z: -16, yaw: Math.PI + 0.4 },
      { x: 0, z: -15, yaw: Math.PI },
      { x: -12, z: -18, yaw: Math.PI },
      { x: 12, z: -18, yaw: Math.PI },
    ],
    T: [
      { x: -5, z: 18, yaw: 0 },
      { x: 0, z: 18, yaw: 0 },
      { x: 5, z: 18, yaw: 0 },
      { x: -8, z: 16, yaw: 0.4 },
      { x: 8, z: 16, yaw: -0.4 },
      { x: 0, z: 15, yaw: 0 },
      { x: -12, z: 18, yaw: 0 },
      { x: 12, z: 18, yaw: 0 },
    ],
    HUMAN: [
      { x: -5, z: -18, yaw: 0 },
      { x: 5, z: -18, yaw: 0 },
      { x: -5, z: 18, yaw: Math.PI },
      { x: 5, z: 18, yaw: Math.PI },
      { x: -18, z: -5, yaw: Math.PI / 2 },
      { x: 18, z: 5, yaw: -Math.PI / 2 },
    ],
    ZOMBIE: [
      { x: 0, z: 0, y: PLATFORM_H, yaw: Math.PI },
      { x: -8, z: -8, yaw: 0.8 },
      { x: 8, z: 8, yaw: -2.4 },
      { x: 0, z: -12, yaw: 0 },
    ],
  },
  sites: [],
  ammoBoxes: [
    { pos: { x: -16, z: -16 }, respawn: 12 },
    { pos: { x: 16, z: -16 }, respawn: 12 },
    { pos: { x: -16, z: 16 }, respawn: 12 },
    { pos: { x: 16, z: 16 }, respawn: 12 },
  ],
  healthBoxes: [],
  colliders: [
    // 边界
    W(-22, -22, 22, -21),
    W(-22, 21, 22, 22),
    W(-22, -22, -21, 22),
    W(21, -22, 22, 22),
    // 中央高台与台阶
    platform,
    ...stairs,
    // 高台上的矮掩体（趴台可躲，但挡不住近距离）
    CR(-2, -2, 0.9, PLATFORM_H + 0.9),
    CR(2, 2, 0.9, PLATFORM_H + 0.9),
    // 四角立柱
    CR(-11, -11, 1.8, 3.2, 'pillar'),
    CR(11, -11, 1.8, 3.2, 'pillar'),
    CR(-11, 11, 1.8, 3.2, 'pillar'),
    CR(11, 11, 1.8, 3.2, 'pillar'),
    // 环形跑动带上的掩体：交错摆放，逼迫绕行而不是直线对枪
    CR(-9, 0, 2.0, 1.5),
    CR(9, 0, 2.0, 1.5),
    CR(0, -9, 2.0, 1.5),
    CR(0, 9, 2.0, 1.5),
    CR(-15, -6, 1.4, 1.3),
    CR(15, 6, 1.4, 1.3),
    CR(-15, 6, 1.4, 1.3),
    CR(15, -6, 1.4, 1.3),
    // 出生点前的掩体，避免开局被一枪穿两个
    CR(-4, -13, 1.6, 1.4),
    CR(4, -13, 1.6, 1.4),
    CR(-4, 13, 1.6, 1.4),
    CR(4, 13, 1.6, 1.4),
    // 油桶点缀
    CR(-18, 0, 1.0, 1.0, 'barrel'),
    CR(18, 0, 1.0, 1.0, 'barrel'),
    CR(0, -18, 1.0, 1.0, 'barrel'),
    CR(0, 18, 1.0, 1.0, 'barrel'),
  ],
  props: [
    { type: 'light', pos: { x: 0, y: 6, z: 0 }, color: 0xfff0d0, power: 34, distance: 26 },
    { type: 'light', pos: { x: -14, y: 5, z: -14 }, color: 0xcfe4ff },
    { type: 'light', pos: { x: 14, y: 5, z: 14 }, color: 0xcfe4ff },
    { type: 'light', pos: { x: 0, y: 5, z: -18 }, color: 0xcfe4ff },
    // 高台边缘灯带：一眼看出可站立面
    { type: 'strip', pos: { x: 0, y: PLATFORM_H + 0.03, z: -3.05 }, size: { x: 6, y: 0.05, z: 0.1 }, color: 0xffc46b, intensity: 2 },
    { type: 'strip', pos: { x: 0, y: PLATFORM_H + 0.03, z: 3.05 }, size: { x: 6, y: 0.05, z: 0.1 }, color: 0xffc46b, intensity: 2 },
    { type: 'strip', pos: { x: -3.05, y: PLATFORM_H + 0.03, z: 0 }, size: { x: 0.1, y: 0.05, z: 6 }, color: 0xffc46b, intensity: 2 },
    { type: 'strip', pos: { x: 3.05, y: PLATFORM_H + 0.03, z: 0 }, size: { x: 0.1, y: 0.05, z: 6 }, color: 0xffc46b, intensity: 2 },
    // 场地标线（南北中线）
    { type: 'strip', pos: { x: 0, y: 0.02, z: -14 }, size: { x: 0.14, y: 0.02, z: 10 }, color: 0x9fd8ff, intensity: 1.2 },
    { type: 'strip', pos: { x: 0, y: 0.02, z: 14 }, size: { x: 0.14, y: 0.02, z: 10 }, color: 0x9fd8ff, intensity: 1.2 },
    // 远景
    { type: 'silhouette', pos: { x: -48, y: 0, z: -46 }, size: { x: 16, y: 22, z: 14 }, color: 0x4e5a66 },
    { type: 'silhouette', pos: { x: 46, y: 0, z: 44 }, size: { x: 14, y: 18, z: 16 }, color: 0x53606c },
    { type: 'silhouette', pos: { x: 52, y: 0, z: -30 }, size: { x: 12, y: 26, z: 12 }, color: 0x47525d },
    { type: 'sun', pos: { x: -60, y: 44, z: -70 }, color: 0xffe8c0, scale: 24 },
  ],
  // 兜底导航（自动生成失败时使用）：环形 + 高台
  nav: [
    { x: 0, z: -14, links: [1, 2, 7] },
    { x: -14, z: 0, links: [0, 3, 6] },
    { x: 14, z: 0, links: [0, 3, 5] },
    { x: 0, z: 14, links: [1, 2, 4] },
    { x: 0, y: PLATFORM_H, z: 0, links: [5, 6, 7] },
    { x: -8, z: 8, links: [2, 4, 7] },
    { x: -8, z: -8, links: [1, 4, 6] },
    { x: 8, z: 8, links: [3, 4, 5] },
  ],
};
