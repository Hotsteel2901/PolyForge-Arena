// 全局共享常量：协议、队伍、模式、玩家物理、消息类型。

export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;
export const MAX_PLAYERS = 12;
export const MAX_BOTS = 10;

export const TEAM = Object.freeze({
  NONE: 0,
  CT: 1,
  T: 2,
  HUMAN: 1,
  ZOMBIE: 2,
});

export const MODE = Object.freeze({
  DEFUSAL: 'defusal',
  ZOMBIE: 'zombie',
});

export const MODE_LABEL = Object.freeze({
  defusal: '拆弹模式',
  zombie: '生化模式',
});

// 客户端 → 服务器
export const C2S = Object.freeze({
  JOIN: 'join',
  INPUT: 'input',
  CHAT: 'chat',
  PING: 'ping',
  BUY: 'buy',
  REFUND: 'refund',
  MOD: 'mod',
});

// 服务器 → 客户端
export const S2C = Object.freeze({
  WELCOME: 'welcome',
  STATE: 'state',
  EVENT: 'event',
  CHAT: 'chat',
  PONG: 'pong',
  ERROR: 'error',
  MOD: 'mod',
});

export const EVENT = Object.freeze({
  ROUND_START: 'round_start',
  ROUND_END: 'round_end',
  MATCH_END: 'match_end',
  KILL: 'kill',
  PLANT: 'bomb_planted',
  DEFUSE: 'bomb_defused',
  EXPLODE: 'bomb_exploded',
  DAMAGE: 'damage',
  HIT: 'hit',
  INFECTED: 'infected',
  PLAYER_JOINED: 'player_joined',
  PLAYER_LEFT: 'player_left',
  PLAYER_SPAWN: 'player_spawn',
  PLAYER_DEATH: 'player_death',
  AMMO_BOX: 'ammo_box',
  MOD: 'mod',
});

// 玩家物理常量（单位：米/秒，米）
export const PHYS = Object.freeze({
  HALF: 0.35,          // 玩家碰撞半宽
  STAND_H: 1.8,        // 站立高度
  CROUCH_H: 1.2,       // 蹲下高度
  EYE_STAND: 1.62,
  EYE_CROUCH: 1.05,
  SPEED: 4.6,          // 人类基础速度
  SPRINT_MULT: 1.3,
  CROUCH_MULT: 0.55,
  ZOMBIE_SPEED: 5.4,
  ZOMBIE_JUMP: 6.9,
  ZOMBIE_HP: 600,
  ZOMBIE_REGEN: 4,
  ZOMBIE_SLOW_TICKS: 15,
  ZOMBIE_SLOW_MULT: 0.55,
  JUMP: 5.8,
  GRAVITY: -14,
  TERMINAL: -22,
});

export const WEAPON_SLOTS = Object.freeze({
  KNIFE: 0,
  PISTOL: 1,
  PRIMARY: 2,
  GRENADE: 3,
});

// 生化模式“琉璃决战”末段：最后 60 秒全员变身、不再复活
export const FINALE = Object.freeze({
  DURATION: 60,
  HUNTER_HP: 500,
  HUNTER_ARMOR: 100,
  HUNTER_DAMAGE: 3.0,
  KING_HP: 1200,
  KING_ARMOR: 80,
  KING_DAMAGE: 2.6, // 必须略低于琉璃猎人
  SERVANT_HP: 800,
  SERVANT_ARMOR: 40,
  SERVANT_DAMAGE: 1.6,
  ZOMBIE_HP_MULT: 1.3, // 其余丧尸仅小幅提升血量
});

// 生化模式丧尸加速技能（F 键）
export const ZOMBIE_BOOST_SPEED = 8.0;
export const ZOMBIE_BOOST_DURATION = 3;
export const ZOMBIE_BOOST_COOLDOWN = 20;

// 回血箱每次回复量（人类在生化模式中使用）
export const HEALTH_BOX_HEAL = 100;

export const INPUT_MAX_HISTORY = 64;
// VibeHub 规范：实时快照频率 15-20Hz。模拟仍在 30Hz 固定步长运行（TICK_RATE），
// 快照每 50ms 广播一次（20Hz），控制 P2P 带宽；客户端以 50ms 缓冲 + 100ms 插值窗口渲染。
export const SNAPSHOT_INTERVAL_MS = 1000 / 20;
