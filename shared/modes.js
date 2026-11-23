// 模式定义（服务端与客户端共用）：7 大竞技模式统一声明。

export const GG_LADDER = Object.freeze(['k9', 'vx9', 'arc17', 'warden', 'bruiser', 'longshot', 'fang']);

export const MODES = Object.freeze({
  defusal: {
    id: 'defusal',
    label: '拆弹模式',
    short: '拆弹',
    teamBased: true,
    buy: true,
    respawn: false,
    sites: true,
    rounds: true,
    intro: 'T 方安放炸弹，CT 方阻止或拆除，经典战术爆破',
  },
  zombie: {
    id: 'zombie',
    label: '生化模式',
    short: '生化',
    teamBased: true,
    buy: false,
    respawn: true,
    sites: false,
    rounds: true,
    intro: '人类坚守至倒计时结束，被尸爪感染后加入丧尸阵营',
  },
  tdm: {
    id: 'tdm',
    label: '团队死斗',
    short: '死斗',
    teamBased: true,
    buy: false,
    respawn: true,
    sites: false,
    rounds: false,
    scoreLimit: 60,
    roundTime: 420,
    respawnDelay: 3,
    intro: '满配极速复活，先到 60 杀的队伍获胜',
  },
  gungame: {
    id: 'gungame',
    label: '军备竞赛',
    short: '军备',
    teamBased: false,
    buy: false,
    respawn: true,
    sites: false,
    rounds: false,
    roundTime: 600,
    respawnDelay: 2,
    ladder: GG_LADDER,
    intro: '每击杀一次升级武器，用战术匕首完成终结夺冠',
  },
  ffa: {
    id: 'ffa',
    label: '个人混战',
    short: '混战',
    teamBased: false,
    buy: false,
    respawn: true,
    sites: false,
    rounds: false,
    scoreLimit: 25,
    roundTime: 480,
    respawnDelay: 2,
    killHeal: 25,
    intro: '全员各自为战，击杀回血 +25 HP，先到 25 杀称王',
  },
  sniper: {
    id: 'sniper',
    label: '飞天瞬狙',
    short: '瞬狙',
    teamBased: true,
    buy: false,
    respawn: true,
    sites: false,
    rounds: false,
    scoreLimit: 30,
    roundTime: 420,
    respawnDelay: 2,
    gravityMult: 0.68,
    forcedPrimary: 'longshot',
    intro: '低重力高跳 + 全员 Longshot 狙击与匕首，先到 30 杀获胜',
  },
  koth: {
    id: 'koth',
    label: '据点争夺',
    short: '据点',
    teamBased: true,
    buy: false,
    respawn: true,
    sites: true,
    rounds: false,
    scoreLimit: 120,
    roundTime: 480,
    respawnDelay: 3,
    intro: '占领中央高亮据点持续得分，先达 120 分的队伍获胜',
  },
});

export function modeCfg(mode) {
  return MODES[mode] || MODES.defusal;
}

export function isTeamBased(mode) {
  return modeCfg(mode).teamBased;
}
