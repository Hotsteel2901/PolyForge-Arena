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
  TDM: 'tdm',
  GUNGAME: 'gungame',
  FFA: 'ffa',
  SNIPER: 'sniper',
  KOTH: 'koth',
});

export const MODE_LABEL = Object.freeze({
  defusal: '拆弹模式',
  zombie: '生化模式',
  tdm: '团队死斗',
  gungame: '军备竞赛',
  ffa: '个人混战',
  sniper: '飞天瞬狙',
  koth: '据点争夺',
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
  HALF: 0.35,
  STAND_H: 1.8,
  CROUCH_H: 1.2,
  EYE_STAND: 1.62,
  EYE_CROUCH: 1.05,
  SPEED: 4.75,
  SPRINT_MULT: 1.32,
  CROUCH_MULT: 0.56,
  ZOMBIE_SPEED: 5.05,
  ZOMBIE_JUMP: 7.0,
  ZOMBIE_HP: 420,
  ZOMBIE_REGEN: 2.5,
  ZOMBIE_SLOW_TICKS: 15,
  ZOMBIE_SLOW_MULT: 0.55,
  JUMP: 5.9,
  GRAVITY: -14,
  TERMINAL: -22,
});

export const WEAPON_SLOTS = Object.freeze({
  KNIFE: 0,
  PISTOL: 1,
  PRIMARY: 2,
  GRENADE: 3,
});

export const FINALE = Object.freeze({
  DURATION: 60,
  HUNTER_HP: 500,
  HUNTER_ARMOR: 100,
  HUNTER_DAMAGE: 1.7,
  KING_HP: 2600,
  KING_ARMOR: 120,
  KING_DAMAGE: 1.6,
  SERVANT_HP: 1500,
  SERVANT_ARMOR: 70,
  SERVANT_DAMAGE: 1.25,
  ZOMBIE_HP_MULT: 2.0,
});

export const ZOMBIE_BOOST_SPEED = 8.2;
export const ZOMBIE_BOOST_DURATION = 3.2;
export const ZOMBIE_BOOST_COOLDOWN = 18;
export const HEALTH_BOX_HEAL = 100;
export const INPUT_MAX_HISTORY = 64;
export const SNAPSHOT_INTERVAL_MS = 1000 / 20;
