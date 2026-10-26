// Hive：原创生化模式地图（室内蜂巢结构）。
// 3×3 房间 + 十字走廊：每个房间至少两个门，避免出现"死角房"被堵门；
// 中央大厅四根立柱给人类绕柱走位的空间，也让丧尸能靠数量包夹。

const W = (x1, z1, x2, z2, h = 6.4, y = 0, type = 'wall') => ({
  min: { x: Math.min(x1, x2), y, z: Math.min(z1, z2) },
  max: { x: Math.max(x1, x2), y: y + h, z: Math.max(z1, z2) },
  type,
});

const CR = (x, z, s = 1.2, h = 1.4, type = 'crate') => ({
  min: { x: x - s / 2, y: 0, z: z - s / 2 },
  max: { x: x + s / 2, y: h, z: z + s / 2 },
  type,
});

// 隔墙：每段留门。竖墙在 z∈(-17,-13) / (-3,3) / (13,17) 开口；
// 横墙同理在 x 方向开口。门宽 4~6m，丧尸冲锋时不会被单个玩家卡死。
const walls = [];
for (const x of [-8, 7]) {
  const segs = [[-24, -17], [-13, -3], [3, 13], [17, 24]];
  for (const [z1, z2] of segs) walls.push(W(x, z1, x + 1, z2, 6.4));
}
for (const z of [-8, 7]) {
  const segs = [[-24, -17], [-13, -3], [3, 13], [17, 24]];
  for (const [x1, x2] of segs) walls.push(W(x1, z, x2, z + 1, 6.4));
}

export default {
  id: 'hive',
  name: 'Hive 蜂巢',
  mode: 'zombie',
  size: { x: 48, z: 48 },
  sky: { top: 0x0d1a14, bottom: 0x2c4436, fog: 0x16251c, near: 6, far: 58 },
  // 室内没有天空补光：抬高环境光/半球光，压低平行光，避免走廊黑成一片
  lighting: { ambient: 0.30, hemi: 0.55, sun: 1.15 },
  floorColor: 0x4a5a4c,
  wallColor: 0x6e7a6c,
  // emissive 会按线性空间解释，值给小了等于没给：0x55645c 在 ACES 下才像深灰天花板
  ceiling: { y: 6.4, color: 0x3a4a42, emissive: 0x55645c },
  ambient: 'indoor',
  spawns: {
    HUMAN: [
      { x: -15.5, z: -15.5, yaw: Math.PI * 0.75 },
      { x: -15.5, z: 15.5, yaw: -Math.PI * 0.75 },
      { x: 15.5, z: -15.5, yaw: Math.PI * 0.25 },
      { x: 15.5, z: 15.5, yaw: -Math.PI * 0.25 },
      { x: -15.5, z: 0, yaw: Math.PI / 2 },
      { x: 15.5, z: 0, yaw: -Math.PI / 2 },
      { x: 0, z: -15.5, yaw: 0 },
      { x: 0, z: 15.5, yaw: Math.PI },
      { x: -18, z: -12, yaw: Math.PI * 0.8 },
      { x: 18, z: 12, yaw: -Math.PI * 0.2 },
      { x: -12, z: 18, yaw: -Math.PI * 0.8 },
      { x: 12, z: -18, yaw: Math.PI * 0.2 },
    ],
    ZOMBIE: [
      { x: 0, z: 0, yaw: Math.PI },
      { x: -3, z: 3, yaw: -2.4 },
      { x: 3, z: -3, yaw: 0.7 },
      { x: 0, z: 4, yaw: 3.1 },
    ],
  },
  sites: [],
  ammoBoxes: [
    { pos: { x: -15.5, z: -15.5 }, respawn: 18 },
    { pos: { x: 15.5, z: -15.5 }, respawn: 18 },
    { pos: { x: -15.5, z: 15.5 }, respawn: 18 },
    { pos: { x: 15.5, z: 15.5 }, respawn: 18 },
    { pos: { x: 0, z: -15.5 }, respawn: 18 },
    { pos: { x: 0, z: 15.5 }, respawn: 18 },
  ],
  healthBoxes: [
    { pos: { x: -15.5, z: 0 }, respawn: 24 },
    { pos: { x: 15.5, z: 0 }, respawn: 24 },
    { pos: { x: 0, z: 0 }, respawn: 30 },
    { pos: { x: -8, z: -18 }, respawn: 24 },
    { pos: { x: 8, z: 18 }, respawn: 24 },
  ],
  colliders: [
    // 外墙
    W(-24, -24, 24, -23, 6.4),
    W(-24, 23, 24, 24, 6.4),
    W(-24, -24, -23, 24, 6.4),
    W(23, -24, 24, 24, 6.4),
    ...walls,
    // 中央大厅四柱
    CR(-4, -4, 1.0, 6.4, 'pillar'),
    CR(4, -4, 1.0, 6.4, 'pillar'),
    CR(-4, 4, 1.0, 6.4, 'pillar'),
    CR(4, 4, 1.0, 6.4, 'pillar'),
    // 各房间掩体（避开门口与房间中心，保证绕行空间）
    CR(-19, -19, 1.8, 1.5),
    CR(-12, -12, 1.6, 1.3),
    CR(19, -19, 1.8, 1.5),
    CR(12, -12, 1.6, 1.3),
    CR(-19, 19, 1.8, 1.5),
    CR(-12, 12, 1.6, 1.3),
    CR(19, 19, 1.8, 1.5),
    CR(12, 12, 1.6, 1.3),
    CR(-19, 0, 1.4, 1.2),
    CR(19, 0, 1.4, 1.2),
    CR(0, -19, 1.4, 1.2),
    CR(0, 19, 1.4, 1.2),
    // 走廊油桶
    CR(-12, -6, 1.0, 1.0, 'barrel'),
    CR(12, 6, 1.0, 1.0, 'barrel'),
    CR(-6, 12, 1.0, 1.0, 'barrel'),
    CR(6, -12, 1.0, 1.0, 'barrel'),
    CR(-18, -6, 1.0, 1.0, 'barrel'),
    CR(18, 6, 1.0, 1.0, 'barrel'),
  ],
  props: [
    // 天花板灯（真光源上限 4，其余用灯带补光）
    { type: 'light', pos: { x: 0, y: 5.4, z: 0 }, color: 0xbdffe0, power: 34, distance: 20 },
    { type: 'light', pos: { x: -15.5, y: 5.2, z: -15.5 }, color: 0xa8ffd0 },
    { type: 'light', pos: { x: 15.5, y: 5.2, z: 15.5 }, color: 0xa8ffd0 },
    { type: 'light', pos: { x: 0, y: 5.2, z: 15.5 }, color: 0xa8ffd0 },
    // 走廊地面导向灯带
    { type: 'strip', pos: { x: 0, y: 0.03, z: -17 }, size: { x: 5.6, y: 0.03, z: 0.16 }, color: 0x4dffa6, intensity: 1.6 },
    { type: 'strip', pos: { x: 0, y: 0.03, z: 17 }, size: { x: 5.6, y: 0.03, z: 0.16 }, color: 0x4dffa6, intensity: 1.6 },
    { type: 'strip', pos: { x: -17, y: 0.03, z: 0 }, size: { x: 0.16, y: 0.03, z: 5.6 }, color: 0x4dffa6, intensity: 1.6 },
    { type: 'strip', pos: { x: 17, y: 0.03, z: 0 }, size: { x: 0.16, y: 0.03, z: 5.6 }, color: 0x4dffa6, intensity: 1.6 },
    // 墙面生物荧光条：给走廊一点辨识度，方向靠色温区分
    { type: 'strip', pos: { x: 0, y: 3.2, z: 7.94 }, size: { x: 5.4, y: 0.1, z: 0.05 }, color: 0x6effc0, intensity: 1.8 },
    { type: 'strip', pos: { x: 0, y: 3.2, z: -8.06 }, size: { x: 5.4, y: 0.1, z: 0.05 }, color: 0x6effc0, intensity: 1.8 },
    { type: 'strip', pos: { x: 7.94, y: 3.2, z: 0 }, size: { x: 0.05, y: 0.1, z: 5.4 }, color: 0x6effc0, intensity: 1.8 },
    { type: 'strip', pos: { x: -8.06, y: 3.2, z: 0 }, size: { x: 0.05, y: 0.1, z: 5.4 }, color: 0x6effc0, intensity: 1.8 },
    // 顶部管道
    { type: 'pipe', pos: { x: 0, y: 6.0, z: -12 }, len: 44, axis: 'z', radius: 0.22 },
    { type: 'pipe', pos: { x: -12, y: 5.7, z: 0 }, len: 44, axis: 'x', radius: 0.16 },
    // 门框标识
    { type: 'sign', text: 'H', pos: { x: 0, y: 4.6, z: 0 }, color: 0x6effc0, scale: 0.8 },
  ],
  // 自动导航图失败时的兜底：十字走廊 + 四角房间
  nav: [
    { x: 0, z: 0, links: [1, 2, 3, 4] },
    { x: 0, z: -15.5, links: [0, 5, 6] },
    { x: 0, z: 15.5, links: [0, 7, 8] },
    { x: -15.5, z: 0, links: [0, 5, 7] },
    { x: 15.5, z: 0, links: [0, 6, 8] },
    { x: -15.5, z: -15.5, links: [1, 3] },
    { x: 15.5, z: -15.5, links: [1, 4] },
    { x: -15.5, z: 15.5, links: [2, 3] },
    { x: 15.5, z: 15.5, links: [2, 4] },
  ],
};
