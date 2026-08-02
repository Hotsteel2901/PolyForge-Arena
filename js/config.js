// VibeHub 部署配置。
// VIBE_WORK 必须与 vibeapps 试玩地址第一段路径相同（项目 slug），例如
//   https://vibeapps.lumigrav.space/polyforge-arena/  →  'polyforge-arena'
// 从创作者中心“我的项目”或 `vibehub list` 复制，不能从标题猜。
// 也支持 URL 参数覆盖：打开游戏时附加 ?work=你的slug 用于测试。
export const VIBE_WORK_PLACEHOLDER = '聚变熔炉竞技场';
export const VIBE_WORK = 'polyforge-arena';

export const CONFIG = Object.freeze({
  // 每房 Bot 数量与人类上限（房主权威模拟的规模）
  bots: 8,
  maxPlayers: 12,
  mods: true,
});

export function resolveWork() {
  try {
    const p = new URLSearchParams(location.search);
    if (p.get('work')) return p.get('work');
  } catch {
    // ignore
  }
  return VIBE_WORK;
}
