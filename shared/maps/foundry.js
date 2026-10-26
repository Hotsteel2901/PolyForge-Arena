// Foundry：原创拆弹地图（对称双点 + 北侧高空天桥）。
// 设计意图：地面是三条纵向通路（西 / 中 / 东），天桥只连北侧，形成"拿高点换暴露"的取舍。
// 所有高度差都用 0.4m 台阶连接，玩家与 Bot 共用自动上台阶逻辑，无需特殊处理。

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

// 天桥：2.2~2.4m 薄板，下方可通行（不做成实心方块，避免把通道堵死）
const CATWALK_Y = 2.4;
const catwalk = {
  min: { x: -22, y: CATWALK_Y - 0.2, z: -22 },
  max: { x: 22, y: CATWALK_Y, z: -18.5 },
  type: 'platform',
};

// 两组楼梯（x∈[-16,-12] / [12,16]），自南向北每级升 0.4m，共 6 级
const stairs = [];
for (let i = 0; i < 6; i++) {
  const zMin = -18.5 + i;
  const h = 0.4 * (6 - i);
  stairs.push({
    min: { x: -16, y: 0, z: zMin },
    max: { x: -12, y: h, z: zMin + 1 },
    type: 'step',
  });
  stairs.push({
    min: { x: 12, y: 0, z: zMin },
    max: { x: 16, y: h, z: zMin + 1 },
    type: 'step',
  });
}

export default {
  id: 'foundry',
  name: 'Foundry 熔炉厂',
  mode: 'defusal',
  size: { x: 56, z: 56 },
  sky: { top: 0x342a1c, bottom: 0xd9a05a, fog: 0x8a6a44, near: 12, far: 96 },
  lighting: { ambient: 0.10, hemi: 0.8, sun: 2.2 },
  floorColor: 0x6a6459,
  wallColor: 0x8a8377,
  ambient: 'industrial',
  spawns: {
    CT: [
      { x: -24, z: -6, yaw: -Math.PI / 2 },
      { x: -24, z: 6, yaw: -Math.PI / 2 },
      { x: -24, z: -3, yaw: -Math.PI / 2 },
      { x: -24, z: 3, yaw: -Math.PI / 2 },
      { x: -22, z: -7, yaw: -Math.PI / 2 },
      { x: -22, z: 7, yaw: -Math.PI / 2 },
    ],
    T: [
      { x: 24, z: -6, yaw: Math.PI / 2 },
      { x: 24, z: 6, yaw: Math.PI / 2 },
      { x: 24, z: -3, yaw: Math.PI / 2 },
      { x: 24, z: 3, yaw: Math.PI / 2 },
      { x: 22, z: -7, yaw: Math.PI / 2 },
      { x: 22, z: 7, yaw: Math.PI / 2 },
    ],
    HUMAN: [
      { x: -20, z: -14, yaw: 0.7 },
      { x: -20, z: 14, yaw: -0.7 },
      { x: 20, z: -14, yaw: Math.PI - 0.7 },
      { x: 20, z: 14, yaw: Math.PI + 0.7 },
      { x: 0, z: -10, yaw: 0 },
      { x: 0, z: 12, yaw: Math.PI },
    ],
    ZOMBIE: [
      { x: 0, y: CATWALK_Y, z: -20, yaw: Math.PI },
      { x: -14, y: CATWALK_Y, z: -20, yaw: Math.PI },
      { x: 14, y: CATWALK_Y, z: -20, yaw: Math.PI },
      { x: 0, z: 0, yaw: 0 },
    ],
  },
  sites: [
    { id: 'A', pos: { x: -12, y: 0, z: -10 }, radius: 2.8, color: 0xffcc33 },
    { id: 'B', pos: { x: 12, y: 0, z: 10 }, radius: 2.8, color: 0xffcc33 },
  ],
  ammoBoxes: [
    { pos: { x: -24, z: -6 }, respawn: 25 },
    { pos: { x: 24, z: 6 }, respawn: 25 },
  ],
  healthBoxes: [],
  colliders: [
    // 边界
    W(-28, -28, 28, -27, 6),
    W(-28, 27, 28, 28, 6),
    W(-28, -28, -27, 28, 6),
    W(27, -28, 28, 28, 6),
    // 中央熔炉：实心大方块，逼出东西两条长通道
    W(-4, -4, 4, 4, 6),
    // 熔炉外侧的四个矮墩，形成绕炉掩体
    CR(-6.5, -6.5, 1.6, 1.2),
    CR(6.5, -6.5, 1.6, 1.2),
    CR(-6.5, 6.5, 1.6, 1.2),
    CR(6.5, 6.5, 1.6, 1.2),
    // A 点（西北）半开放房间：北/西实墙，东侧留 6m 缺口
    W(-18, -16, -7, -15, 3.4),
    W(-18, -16, -17, -6, 3.4),
    W(-8, -15, -7, -12, 3.4),
    // B 点（东南）镜像
    W(7, 15, 18, 16, 3.4),
    W(17, 6, 18, 16, 3.4),
    W(7, 12, 8, 15, 3.4),
    // 中路短墙：切断中央直线对枪，逼迫侧移
    W(-2, -12, 2, -11, 2.4),
    W(-2, 11, 2, 12, 2.4),
    // 出生点前的矮掩体
    W(-22, -1.5, -18, 1.5, 2),
    W(18, -1.5, 22, 1.5, 2),
    // 地面掩体 / 箱子
    CR(-10, 2, 1.5, 1.3),
    CR(-8, 6, 1.2, 1.1),
    CR(10, -2, 1.5, 1.3),
    CR(8, -6, 1.2, 1.1),
    CR(-14, 10, 1.4, 1.2),
    CR(14, -10, 1.4, 1.2),
    CR(0, 14, 1.6, 1.2),
    CR(0, -14, 1.6, 1.2),
    CR(-20, 12, 1.3, 1.1),
    CR(20, -12, 1.3, 1.1),
    // 天桥与楼梯
    catwalk,
    ...stairs,
    // 天桥护栏（矮墙）：防止直接从天桥边缘掉落，同时提供掩体
    W(-22, -18.5, -16.5, -18.2, 1, CATWALK_Y),
    W(-11.5, -18.5, 11.5, -18.2, 1, CATWALK_Y),
    W(16.5, -18.5, 22, -18.2, 1, CATWALK_Y),
    // 油桶
    CR(-24, -16, 1.0, 1.0, 'barrel'),
    CR(24, 16, 1.0, 1.0, 'barrel'),
    CR(-16, 18, 1.0, 1.0, 'barrel'),
    CR(16, -18, 1.0, 1.0, 'barrel'),
    CR(-6, -20, 1.0, 1.0, 'barrel'),
    CR(6, 20, 1.0, 1.0, 'barrel'),
  ],
  props: [
    // 熔炉顶部火光
    { type: 'light', pos: { x: 0, y: 6.5, z: 0 }, color: 0xffb45e, power: 30, distance: 22 },
    { type: 'light', pos: { x: -12, y: 5, z: -10 }, color: 0xffd9a0 },
    { type: 'light', pos: { x: 12, y: 5, z: 10 }, color: 0xffd9a0 },
    { type: 'light', pos: { x: 0, y: 5, z: -20 }, color: 0x9fd0ff },
    // 熔炉侧壁的灼热缝隙
    { type: 'strip', pos: { x: 0, y: 1.6, z: 4.06 }, size: { x: 7.2, y: 0.18, z: 0.06 }, color: 0xff7a2a, intensity: 3 },
    { type: 'strip', pos: { x: 0, y: 1.6, z: -4.06 }, size: { x: 7.2, y: 0.18, z: 0.06 }, color: 0xff7a2a, intensity: 3 },
    { type: 'strip', pos: { x: 4.06, y: 1.6, z: 0 }, size: { x: 0.06, y: 0.18, z: 7.2 }, color: 0xff9a3a, intensity: 2.4 },
    { type: 'strip', pos: { x: -4.06, y: 1.6, z: 0 }, size: { x: 0.06, y: 0.18, z: 7.2 }, color: 0xff9a3a, intensity: 2.4 },
    // 天桥底灯带：走桥下时能看清结构
    { type: 'strip', pos: { x: -8, y: CATWALK_Y - 0.24, z: -20.2 }, size: { x: 13, y: 0.05, z: 0.1 }, color: 0xffe6b0, intensity: 1.6 },
    { type: 'strip', pos: { x: 8, y: CATWALK_Y - 0.24, z: -20.2 }, size: { x: 13, y: 0.05, z: 0.1 }, color: 0xffe6b0, intensity: 1.6 },
    // 管道与远景
    { type: 'pipe', pos: { x: -26.4, y: 3.2, z: 0 }, len: 50, axis: 'z', radius: 0.24 },
    { type: 'pipe', pos: { x: 26.4, y: 3.6, z: 0 }, len: 50, axis: 'z', radius: 0.18 },
    { type: 'pipe', pos: { x: 0, y: 4.4, z: 26.4 }, len: 48, axis: 'x', radius: 0.2 },
    // 远景厂房剪影：放在边界外 30m 以上，只作天际线，不能糊在墙边遮挡视野
    { type: 'silhouette', pos: { x: -62, y: 0, z: -56 }, size: { x: 16, y: 20, z: 14 }, color: 0x6a5c4a },
    { type: 'silhouette', pos: { x: -44, y: 0, z: -66 }, size: { x: 22, y: 30, z: 16 }, color: 0x5e5242 },
    { type: 'silhouette', pos: { x: 56, y: 0, z: -62 }, size: { x: 20, y: 26, z: 18 }, color: 0x605443 },
    { type: 'silhouette', pos: { x: 66, y: 0, z: -34 }, size: { x: 14, y: 16, z: 16 }, color: 0x6a5c4a },
    { type: 'silhouette', pos: { x: 60, y: 0, z: 44 }, size: { x: 18, y: 14, z: 20 }, color: 0x5c5040 },
    { type: 'silhouette', pos: { x: -58, y: 0, z: 48 }, size: { x: 20, y: 18, z: 16 }, color: 0x665949 },
    { type: 'sun', pos: { x: -70, y: 46, z: -80 }, color: 0xffd6a0, scale: 26 },
    // 点位旁的告示
    { type: 'sign', text: 'A', pos: { x: -12, y: 3.4, z: -15.4 }, color: 0xffcc33 },
    { type: 'sign', text: 'B', pos: { x: 12, y: 3.4, z: 15.4 }, color: 0xffcc33 },
  ],
  // 仅作自动导航图生成失败时的兜底：绕熔炉的一圈 + 两侧出生点 + 天桥
  nav: [
    { x: 0, z: -10, links: [1, 7, 12] },
    { x: 10, z: -10, links: [0, 2, 10] },
    { x: 10, z: 0, links: [1, 3] },
    { x: 10, z: 10, links: [2, 4, 13] },
    { x: 0, z: 10, links: [3, 5] },
    { x: -10, z: 10, links: [4, 6, 9] },
    { x: -10, z: 0, links: [5, 7, 8] },
    { x: -10, z: -10, links: [6, 0, 12, 17] },
    { x: -24, z: -6, links: [6] },
    { x: -24, z: 6, links: [5] },
    { x: 24, z: -6, links: [1] },
    { x: 24, z: 6, links: [3] },
    { x: -12, z: -10, links: [0, 7] },
    { x: 12, z: 10, links: [3, 4] },
    { x: -14, y: CATWALK_Y, z: -20, links: [15, 17] },
    { x: 0, y: CATWALK_Y, z: -20, links: [14, 16] },
    { x: 14, y: CATWALK_Y, z: -20, links: [15, 18] },
    { x: -14, z: -13, links: [7, 14] },
    { x: 14, z: -13, links: [10, 16] },
  ],
};
