// 模式定义（服务端与客户端共用）：一处声明，避免两端各写一份 if/else 慢慢漂移。
//
// 字段说明：
//   teamBased  是否分队（军备竞赛是自由混战）
//   buy        是否有购买阶段
//   respawn    死亡后是否自动复活
//   sites      是否有炸弹安放点
//   rounds     是否按"回合"结算（死亡不复活 / 回合结束切图）
//   scoreLimit 团队死斗的取胜击杀数
//   roundTime  单局时长（秒）
//   ladder     军备竞赛的武器阶梯（最后一个用近战武器收尾）
//
// 新增模式时：这里加一条 + host/modes/ 加一个状态机 + Room 里接入 kill/spawn，
// 客户端（HUD/菜单/结算）会自动跟随 modeCfg，不需要再散落判断。

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
    intro: 'T 方安放炸弹，CT 方阻止或拆除',
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
    intro: '人类撑到时间结束，被咬到即感染',
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
    intro: '先到 60 杀的队伍获胜，阵亡 3 秒复活',
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
    intro: '每击杀一次升级武器，用匕首收尾夺冠',
  },
});

export function modeCfg(mode) {
  return MODES[mode] || MODES.defusal;
}

export function isTeamBased(mode) {
  return modeCfg(mode).teamBased;
}
