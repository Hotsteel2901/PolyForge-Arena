// 服务器玩家对象：创建、装备、生成、受伤、死亡。

import { PHYS, TEAM } from '../shared/constants.js';
import { WeaponRuntime, BUILTIN_WEAPONS } from '../shared/weapons.js';
import { applyArmor } from '../shared/math.js';
import { PositionHistory } from './history.js';
import { START_MONEY, MONEY_CAP, KILL_REWARD, ZOMBIE_KILL_REWARD, ZOMBIE_START_MONEY } from '../shared/economy.js';

export function createPlayer(id, name, { isBot = false } = {}) {
  return {
    id,
    name,
    isBot,
    team: TEAM.NONE,
    teamPref: 'random',
    alive: false,
    pos: { x: 0, y: 2, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    grounded: true,
    crouch: false,
    hp: 100,
    maxHp: 100,
    armor: 0,
    weapons: new Map(),
    activeSlot: 1,
    grenadeCount: 1,
    money: START_MONEY,
    boughtItems: [],
    bombCarrier: false,
    isZombie: false,
    score: 0,
    kills: 0,
    deaths: 0,
    respawnAt: 0,
    lastHitAt: -99,
    input: { mv: [0, 0, 0, 0], j: 0, s: 0, c: 0, yaw: 0, pitch: 0, fire: 0, ads: 0, r: 0, sw: -1, swd: 0, u: 0 },
    edge: { sw: -1, swd: 0, r: 0, j: 0, u: 0 },
    switchSeq: 0,
    lastUseProgressAt: 0,
    useProgress: 0,
    useTarget: null,
    weaponMoveMult: 1,
    botBrain: null,
    history: new PositionHistory(),
    inputAt: 0,
    wasFiring: false,
    slowTicks: 0,
    selectedPrimary: null, // 生化模式选枪：重生后仍保持所选主武器
    zombieMoneyInit: false,
  };
}

export function giveLoadout(p, mode, team) {
  p.weapons.clear();
  p.activeSlot = 1;
  p.weaponMoveMult = 1;
  p.grenadeCount = 0;
  if (p.isZombie) {
    const claw = { ...BUILTIN_WEAPONS.fang, id: 'zclaw', name: '尸爪', range: 2.3, damage: 26, fireRate: 68, moveMult: 1 };
    p.weapons.set(0, new WeaponRuntime(claw));
    p.activeSlot = 0;
    return;
  }
  p.weapons.set(0, new WeaponRuntime(BUILTIN_WEAPONS.fang));
  p.weapons.set(1, new WeaponRuntime(BUILTIN_WEAPONS.k9));
  const primary = mode === 'defusal' ? (team === TEAM.T ? BUILTIN_WEAPONS.arc17 : BUILTIN_WEAPONS.vx9) : BUILTIN_WEAPONS.arc17;
  p.weapons.set(2, new WeaponRuntime(primary));
  p.weapons.set(3, new WeaponRuntime(BUILTIN_WEAPONS.thunder));
  p.grenadeCount = 3;
  p.activeSlot = 2;
}

export function spawnPlayer(room, p, team, spawn) {
  p.team = team;
  p.alive = true;
  p.pos = { x: spawn.x, y: spawn.y ?? 0.05, z: spawn.z };
  p.vel = { x: 0, y: 0, z: 0 };
  p.yaw = spawn.yaw ?? 0;
  p.pitch = 0;
  p.grounded = true;
  p.crouch = false;
  p.hp = p.isZombie ? PHYS.ZOMBIE_HP : 100;
  p.maxHp = p.isZombie ? PHYS.ZOMBIE_HP : 100;
  p.armor = p.isZombie ? 0 : 50;
  p.lastHitAt = -99;
  p.respawnAt = 0;
  p.useProgress = 0;
  p.useTarget = null;
  giveLoadout(p, room.mode, team);
  // 触发 mod 钩子（可能替换主武器，如 energy-rifle mod 默认替换），随后再应用玩家选枪的武器，
  // 保证生化模式买的枪在重生后不被 mod 覆盖
  room.emit('player_spawn', { player: p });
  room.broadcast({ type: 'player_spawn', id: p.id, team: p.team, zombie: p.isZombie ? 1 : 0 });
  // 生化模式：加入者初始 1000；人类重生后保持所选主武器（非僵尸）
  if (room.mode === 'zombie') {
    if (!p.zombieMoneyInit) {
      p.money = ZOMBIE_START_MONEY;
      p.zombieMoneyInit = true;
    }
    if (!p.isZombie && p.selectedPrimary && room.weapons.has(p.selectedPrimary)) {
      p.weapons.set(2, new WeaponRuntime(room.weapons.get(p.selectedPrimary)));
      p.activeSlot = 2;
    }
  }
}

export function damagePlayer(room, shooter, victim, amount, info = {}) {
  if (!victim.alive) return null;
  // 友伤拦截：同队伤害直接忽略（含手雷等范围伤害）
  if (shooter && shooter !== victim && shooter.team === victim.team) return null;
  if (victim.isZombie) victim.slowTicks = PHYS.ZOMBIE_SLOW_TICKS;
  const { damage, armor } = applyArmor(amount, victim.armor);
  victim.hp -= damage;
  victim.armor = armor;
  victim.lastHitAt = room.time;
  const result = { victim, damage, armor, headshot: !!info.headshot, weapon: info.weapon ?? 'unknown' };
  room.emit('player_damage', { ...result, attacker: shooter });
  if (shooter && shooter !== victim && shooter.connected) {
    room.sendTo(shooter.id, { type: 'hit', dmg: damage, headshot: result.headshot });
  }
  room.sendTo(victim.id, { type: 'damage', hp: Math.max(0, Math.ceil(victim.hp)), armor: Math.ceil(victim.armor), from: shooter?.id });
  if (victim.hp <= 0) {
    killPlayer(room, shooter, victim, info);
  }
  return result;
}

export function killPlayer(room, killer, victim, info = {}) {
  victim.alive = false;
  victim.deaths += 1;
  room.dropBomb(victim); // 携带者阵亡 → 炸弹掉落在死亡位置
  if (killer && killer !== victim) {
    killer.kills += 1;
    killer.score += 10;
    // 生化模式：只有击杀丧尸才给 200；拆弹模式维持原有击杀奖励
    if (room.mode === 'zombie') {
      if (victim.isZombie) killer.money = Math.min(MONEY_CAP, killer.money + ZOMBIE_KILL_REWARD);
    } else {
      killer.money = Math.min(MONEY_CAP, killer.money + KILL_REWARD);
    }
  } else {
    victim.score -= 5;
  }
  const event = {
    type: 'kill',
    killer: killer?.id,
    victim: victim.id,
    weapon: info.weapon ?? 'unknown',
    headshot: !!info.headshot,
    zombie: victim.isZombie ? 1 : 0,
  };
  room.emit('player_death', { killer, victim, info });
  room.broadcast(event);

  if (room.mode === 'zombie') {
    if (!victim.isZombie) {
      victim.isZombie = true;
      victim.team = TEAM.ZOMBIE;
      victim.respawnAt = room.time + 3.5;
      room.core?.infect(victim.id);
      room.broadcast({ type: 'infected', id: victim.id });
    } else {
      victim.respawnAt = room.time + 4;
    }
    return;
  }

  // 拆弹模式：检查整队是否全灭
  if (room.mode === 'defusal') {
    const tAlive = [...room.players.values()].some((p) => p.alive && p.team === TEAM.T);
    const ctAlive = [...room.players.values()].some((p) => p.alive && p.team === TEAM.CT);
    if (!tAlive) room.core?.teamEliminated('T');
    else if (!ctAlive) room.core?.teamEliminated('CT');
  }
}

export function respawnZombie(room, p) {
  const spawn = room.pickSpawn('ZOMBIE');
  spawnPlayer(room, p, TEAM.ZOMBIE, spawn);
}

export function eyeHeight(p) {
  return p.pos.y + (p.crouch ? 1.05 : 1.62);
}
