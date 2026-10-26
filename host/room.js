// 房间：固定步长模拟、模式编排、输入处理、武器/投掷物/快照/事件总线。

import { TICK_RATE, TICK_MS, SNAPSHOT_INTERVAL_MS, TEAM, S2C, EVENT, PHYS, MODE, FINALE, HEALTH_BOX_HEAL, ZOMBIE_BOOST_SPEED, ZOMBIE_BOOST_DURATION, ZOMBIE_BOOST_COOLDOWN } from '../shared/constants.js';
import { BUILTIN_WEAPONS, WeaponRuntime, shouldFire } from '../shared/weapons.js';
import { PRICES, START_MONEY, MONEY_CAP, WIN_REWARD, LOSS_REWARD, PLANT_REWARD, DEFUSE_REWARD, costOf, ZOMBIE_START_MONEY, weaponPrice } from '../shared/economy.js';
import { MAPS } from '../shared/maps/index.js';
import { movePlayer } from '../shared/physics.js';
import { createPlayer, spawnPlayer, damagePlayer, killPlayer, respawnZombie, giveLoadout, eyeHeight } from './player.js';
import { performShot } from './hitscan.js';
import { tickBot, createBotBrain } from './bots.js';
import { loadServerMods } from './mods.js';
import { DefusalRound } from './modes/defusal-core.js';
import { ZombieMatch } from './modes/zombie-core.js';
import { TdmRound } from './modes/tdm-core.js';
import { GunGameRound } from './modes/gungame-core.js';
import { directionFromAngles } from '../shared/math.js';
import { modeCfg } from '../shared/modes.js';

const BOT_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet'];

// 整场取胜所需回合数（拆弹 = 先到 8 分；生化 = 一方先拿到 8 分且领先对手）
const ROUNDS_TO_WIN = 8;
// 生化模式单局时长（秒）。需大于 FINALE.DURATION，保证"最后 60 秒琉璃决战"有足够铺垫。
const ZOMBIE_DURATION = 330;

export class Room {
  constructor({ id, mode, mapId, maxPlayers = 12, botCount = 8, botSkill = 1, config = {} }) {
    this.id = id;
    this.mode = mode;
    this.modeCfg = modeCfg(mode);
    // 规则表：Mod 可改写（重力倍率、友伤、复活时间…），默认值来自模式定义
    this.rules = {
      gravity: 1,
      friendlyFire: false,
      respawnDelay: this.modeCfg.respawnDelay ?? 3,
      damageMult: 1,
    };
    this.mapId = mapId;
    this.map = MAPS[mapId];
    this.maxPlayers = maxPlayers;
    this.botCount = botCount;
    // botSkill：0=休闲 1=普通 2=高手。传入非法值时回落到 1（普通）
    this.botSkill = [0, 1, 2].includes(Number(botSkill)) ? Number(botSkill) : 1;
    this.paused = false;
    this.config = config;
    this.players = new Map();
    this.connections = new Map(); // id -> send fn
    this.time = 0;
    this.tickAcc = 0;
    this.snapAcc = 0;
    this.weapons = new Map(Object.entries(BUILTIN_WEAPONS));
    this.maps = new Map(Object.entries(MAPS));
    this.handlers = new Map();
    this.projectiles = [];
    this.nextProjId = 1;
    this.ammoBoxes = (this.map.ammoBoxes || []).map((b) => ({ ...b, available: true, respawnAt: 0 }));
    this.healthBoxes = (this.map.healthBoxes || []).map((b) => ({ ...b, available: true, respawnAt: 0 }));
    this.bomb = { planted: false, carried: false, carrierId: null, pos: null, timeLeft: 0 };
    this.finaleActive = false;
    this.noRespawn = false;
    this.core = null;
    this.roundNum = 0;
    this.matchScore = { CT: 0, T: 0, HUMAN: 0, ZOMBIE: 0 };
    this.state = 'live';
    this.phase = 'live';
    this.buyUntil = 0;
    this.roundEndAt = 0;
    this.matchEndAt = 0;
    this.rotation = {
      defusal: ['vertex', 'obsidian', 'foundry'],
      zombie: ['containment', 'hive', 'obsidian'],
      tdm: ['pit', 'foundry', 'vertex'],
      gungame: ['pit', 'vertex', 'foundry'],
    }[mode] || ['vertex', 'obsidian'];
    this.rotationIdx = 0;
    this.modResults = { loaded: [], errors: [] };
    this.commands = new Map(); // 聊天命令（Mod 注册，如 !grav 0.4）
    this.log = (...args) => console.log(`[room:${id}]`, ...args);
    this.nextBotId = 1;
  }

  start() {
    this.readyPromise = (async () => {
      await Promise.resolve(); // 让加入流程先完成（addPlayer 在同步阶段执行）
      if (this.config.mods !== false) await this.reloadMods();
      else this.log('mods disabled (MODS=0)');
      this.fillBots();
      if (this.mode === MODE.DEFUSAL) this.beginBuyPhase();
      else this.startRound();
      this.timer = setInterval(() => this.tick(), TICK_MS);
      this.log(`started mode=${this.mode} map=${this.mapId} bots=${this.countBots()}`);
    })();
    return this.readyPromise;
  }

  async whenReady() {
    if (this.readyPromise) await this.readyPromise;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async reloadMods() {
    this.weapons = new Map(Object.entries(BUILTIN_WEAPONS));
    this.maps = new Map(Object.entries(MAPS));
    this.modResults = await loadServerMods(this);
    this.log(`mods loaded=${this.modResults.loaded.length} errors=${this.modResults.errors.length}`);
    for (const err of this.modResults.errors) this.log('mod error:', err);
  }

  // ---------- 事件总线 ----------
  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
  }

  off(event, fn) {
    const list = this.handlers.get(event);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit(event, data) {
    for (const fn of this.handlers.get(event) || []) {
      try {
        fn(data, this);
      } catch (err) {
        this.log(`handler error on ${event}:`, err.message);
      }
    }
  }

  broadcast(msg) {
    const json = JSON.stringify(msg);
    for (const send of this.connections.values()) {
      try {
        send(json);
      } catch {
        // 连接已失效
      }
    }
  }

  sendTo(id, msg) {
    const send = this.connections.get(id);
    if (send) send(JSON.stringify(msg));
  }

  say(text) {
    this.broadcast({ type: S2C.CHAT, name: 'SYSTEM', text, system: true });
  }

  // ---------- 规则 / 命令 ----------
  // 规则热更新：改完立即广播，客户端本地预测与服务端保持同一套参数
  setRule(key, value) {
    if (!key) return;
    if (value === undefined || value === null) delete this.rules[key];
    else this.rules[key] = value;
    this.broadcast({ type: 'rules', rules: { ...this.rules } });
    this.say(`规则更新：${key} = ${value}`);
    this.log(`rule ${key} = ${value}`);
  }

  registerCommand(name, fn) {
    if (typeof fn === 'function') this.commands.set(String(name).toLowerCase(), fn);
  }

  // 聊天命令：以 ! 开头，命中已注册命令时不再广播给所有人。
  tryCommand(p, text) {
    if (typeof text !== 'string' || text[0] !== '!') return false;
    const parts = text.slice(1).trim().split(/\s+/);
    const name = (parts.shift() || '').toLowerCase();
    const fn = this.commands.get(name);
    if (!fn) return false;
    try {
      fn(p, parts, this);
    } catch (err) {
      this.log(`command ${name} error: ${err.message}`);
      this.sendTo(p.id, { type: 'chat', name: 'SYSTEM', text: `命令执行失败：${err.message}`, system: true });
    }
    return true;
  }

  // ---------- 玩家管理 ----------
  addPlayer(name, teamPref = 'random') {
    if (this.humans() >= this.maxPlayers) return null;
    const id = `h${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    const p = createPlayer(id, name);
    p.teamPref = teamPref === 'ct' || teamPref === 't' ? teamPref : 'random';
    p.ggLadder = this.modeCfg.ladder || null;
    p.ggLevel = 0;
    // 分队：拆弹/死斗按偏好 + 人数补齐；军备竞赛交替分色（只是外观，实际自由混战）
    if (this.mode !== MODE.ZOMBIE) this.assignTeam(p);
    this.players.set(id, p);
    // 若房间满员，挤掉最后一个 bot
    if (this.players.size > this.maxPlayers) {
      const bot = [...this.players.values()].reverse().find((x) => x.isBot);
      if (bot) this.players.delete(bot.id);
    }
    this.log(`player joined: ${name} (${id}), total=${this.players.size}`);
    return p;
  }

  // 分队：拆弹/死斗按偏好并补弱侧；军备竞赛交替分色（队伍只用于外观，实际自由混战）
  assignTeam(p, reset = false) {
    if (this.mode === MODE.GUNGAME) {
      this.ggFlip = !this.ggFlip;
      p.team = this.ggFlip ? TEAM.CT : TEAM.T;
      return p.team;
    }
    if (this.mode === MODE.ZOMBIE) return p.team;
    if (p.teamPref === 't') p.team = TEAM.T;
    else if (p.teamPref === 'ct') p.team = TEAM.CT;
    else {
      const ct = [...this.players.values()].filter((x) => x.team === TEAM.CT).length;
      const t = [...this.players.values()].filter((x) => x.team === TEAM.T).length;
      p.team = ct <= t ? TEAM.CT : TEAM.T;
    }
    return p.team;
  }

  // 军备竞赛升级：击杀 +1 级，换装并通知客户端；到顶（匕首）再击杀即夺冠
  advanceGunGame(killer, victim) {
    const core = this.core;
    if (!core || core.state !== 'live') return;
    const ladder = this.modeCfg.ladder || [];
    const maxLevel = Math.max(0, ladder.length - 1);
    // 用最高级武器（匕首）完成击杀 → 夺冠
    if ((killer.ggLevel || 0) >= maxLevel) {
      this.broadcast({ type: 'gg_win', id: killer.id, name: killer.name });
      core.end(killer.id, killer.name, 'knife');
      return;
    }
    killer.ggLevel = Math.min(maxLevel, (killer.ggLevel || 0) + 1);
    giveLoadout(killer, this.mode, killer.team, this.weapons);
    killer.switchSeq += 1;
    this.sendTo(killer.id, {
      type: 'switch',
      w: killer.weapons.get(killer.activeSlot)?.def.id,
      slot: killer.activeSlot,
      seq: killer.switchSeq,
    });
    this.broadcast({ type: 'gg_level', id: killer.id, name: killer.name, level: killer.ggLevel, weapon: killer.weapons.get(killer.activeSlot)?.def.id });
  }

  spawnJoiner(p) {
    if (!this.core) return; // 开局购买阶段：队伍已在加入时分配
    if (this.core.state === 'ended') return;
    if (p.alive) return; // 已在本回合出生（如开局加入）则不动，避免清掉炸弹携带者
    if (this.mode === MODE.DEFUSAL || this.mode === MODE.TDM || this.mode === MODE.GUNGAME) {
      p.isZombie = false;
      if (this.mode !== MODE.GUNGAME) this.assignTeam(p);
      const spot = this.pickSpawn(p.team === TEAM.CT ? 'CT' : 'T');
      spawnPlayer(this, p, p.team, spot);
    } else {
      // 若开局随机已把该玩家选为僵尸，则保持僵尸身份
      p.team = p.isZombie ? TEAM.ZOMBIE : TEAM.HUMAN;
      const spot = this.pickSpawn(p.isZombie ? 'ZOMBIE' : 'HUMAN');
      spawnPlayer(this, p, p.team, spot);
    }
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.dropBomb(p); // 携带者离房 → 炸弹掉落在原地
    this.players.delete(id);
    this.connections.delete(id);
    this.broadcast({ type: EVENT.PLAYER_LEFT, id, name: p.name });
    if (!p.isBot) this.fillBots();
  }

  humans() {
    return [...this.players.values()].filter((p) => !p.isBot).length;
  }

  countBots() {
    return [...this.players.values()].filter((p) => p.isBot).length;
  }

  fillBots() {
    const want = Math.min(this.botCount, this.maxPlayers - this.humans());
    let have = this.countBots();
    while (have < want) {
      const bot = createPlayer(`b${this.nextBotId++}`, `Bot-${BOT_NAMES[have % BOT_NAMES.length]}`, { isBot: true });
      bot.botBrain = createBotBrain();
      bot.ggLadder = this.modeCfg.ladder || null;
      bot.ggLevel = 0;
      if (this.mode !== MODE.ZOMBIE) this.assignTeam(bot);
      this.players.set(bot.id, bot);
      have++;
    }
  }

  // ---------- 回合编排 ----------
  startRound() {
    this.roundNum += 1;
    this.time = 0;
    this.projectiles = [];
    this.bomb = { planted: false, carried: false, carrierId: null, pos: null, timeLeft: 0 };
    this.roundEndAt = 0;
    this.state = 'live';
    this.phase = 'live';
    this.buyUntil = 0;
    this.finaleActive = false;
    this.noRespawn = false;
    const all = [...this.players.values()];
    for (const p of all) {
      p.boughtPhase = false;
      p.bombCarrier = false;
      p.damageMult = 1;
      p.isCrystalHunter = false;
      p.isZombieKing = false;
      p.isZombieServant = false;
    }

    if (this.mode === MODE.TDM || this.mode === MODE.GUNGAME) {
      this.startContinuousRound();
      return;
    }

    if (this.mode === MODE.DEFUSAL) {
      // 记录上一回合是否存活（进入购买阶段时不会复活，round_start 前 alive 即存活状态）
      const survived = new Map();
      for (const p of all) survived.set(p.id, p.alive);
      const players = all;
      players.forEach((p) => {
        p.isZombie = false;
        p.team = p.teamPref === 'ct' ? TEAM.CT : p.teamPref === 't' ? TEAM.T : TEAM.NONE;
        p.kills = 0;
        p.deaths = 0;
      });
      let ctCount = players.filter((p) => p.team === TEAM.CT).length;
      let tCount = players.filter((p) => p.team === TEAM.T).length;
      for (const p of players) {
        if (p.team === TEAM.NONE) {
          p.team = ctCount <= tCount ? TEAM.CT : TEAM.T;
          if (p.team === TEAM.CT) ctCount += 1;
          else tCount += 1;
        }
      }
      // 装备结算：存活者保留上局装备并补满弹药、继承护甲；阵亡者回基础装备（手持手枪）
      for (const p of all) {
        if (survived.get(p.id)) this.refillAmmo(p);
      }
      this.spawnAll({ keepLoadout: (p) => survived.get(p.id) });
      // 购买阶段购买的装备带入本回合（覆盖/补充到装备栏），然后清空购买记录
      for (const p of all) {
        for (const rec of p.boughtItems) {
          if (rec.slot !== undefined) {
            rec.runtime.reset(0);
            p.weapons.set(rec.slot, rec.runtime);
            if (rec.slot === 2) p.activeSlot = 2;
          }
          else if (rec.item === 'armor') p.armor = 100;
          else if (rec.item === 'grenade') p.grenadeCount = Math.min(5, p.grenadeCount + 1);
        }
        p.boughtItems = [];
      }
      const tAlive = [...this.players.values()].filter((p) => p.team === TEAM.T);
      // 实体炸弹：放在 T 出生点前方（未激活），走近按 E 拾取
      this.placeBombAtSpawn();
      this.core = new DefusalRound({
        roundTime: 105,
        bombTime: 40,
        onEvent: (e) => this.handleRoundEvent(e),
      });
      this.core.start({ tAlive: tAlive.length, ctAlive: all.length - tAlive.length, bombCarrier: null });
    } else {
      all.forEach((p) => {
        p.isZombie = false;
        p.team = TEAM.HUMAN;
        p.money = ZOMBIE_START_MONEY; // 生化模式：开局每人 1000
        p.zombieMoneyInit = true;
        p.zombieSince = 0;
      });
      // 初始僵尸数量：约 18%，单局最多 2 只，避免开局就形成压倒性数量优势
      const zombieCount = Math.max(1, Math.min(2, Math.floor(all.length * 0.18), all.length));
      const pool = [...all].sort(() => Math.random() - 0.5);
      for (let i = 0; i < zombieCount; i++) {
        pool[i].isZombie = true;
        pool[i].team = TEAM.ZOMBIE;
      }
      this.spawnAll();
      this.core = new ZombieMatch({
        duration: ZOMBIE_DURATION,
        onEvent: (e) => this.handleRoundEvent(e),
      });
      const humans = [...all].filter((p) => !p.isZombie);
      const zombies = [...all].filter((p) => p.isZombie);
      this.core.start({ humans: humans.map((p) => p.id), zombies: zombies.map((p) => p.id) });
    }
  }

  // 持续型模式（团队死斗 / 军备竞赛）：一次部署打完整局，靠分数或时间决出胜负
  startContinuousRound() {
    const cfg = this.modeCfg;
    const all = [...this.players.values()];
    for (const p of all) {
      p.isZombie = false;
      this.assignTeam(p, true);
      p.ggLadder = cfg.ladder || null;
      if (this.mode === MODE.GUNGAME) p.ggLevel = 0;
      p.kills = 0;
      p.deaths = 0;
      p.score = 0;
      p.money = 0;
      p.boughtItems = [];
      p.bombCarrier = false;
    }
    this.spawnAll();
    if (this.mode === MODE.TDM) {
      this.core = new TdmRound({
        scoreLimit: cfg.scoreLimit,
        duration: cfg.roundTime,
        onEvent: (e) => this.handleRoundEvent(e),
      });
      this.core.start();
      this.say(`团队死斗开始：先到 ${cfg.scoreLimit} 杀的一方获胜`);
    } else {
      this.core = new GunGameRound({
        duration: cfg.roundTime,
        ladder: cfg.ladder,
        onEvent: (e) => this.handleRoundEvent(e),
      });
      this.core.start();
      this.broadcast({ type: 'gg_start', ladder: cfg.ladder, duration: cfg.roundTime });
      this.say('军备竞赛开始：每次击杀升级武器，用匕首完成最后击杀夺冠');
    }
  }

  // 持续模式复活：保留等级（军备竞赛）与队伍，重新出生
  respawnContinuous(p) {
    const key = p.team === TEAM.CT ? 'CT' : 'T';
    const spot = this.pickSpawn(key);
    spawnPlayer(this, p, p.team, spot, { protect: 1.2 });
  }

  // 实体炸弹放在 T 出生点前方（未激活），方便 T 方开局拾取
  placeBombAtSpawn() {
    const tSpawns = this.map.spawns.T || this.map.spawns['T'] || [{ x: 0, z: 0, yaw: 0 }];
    const s = tSpawns[0];
    const fx = -Math.sin(s.yaw ?? 0);
    const fz = -Math.cos(s.yaw ?? 0);
    this.bomb = {
      planted: false,
      carried: false,
      carrierId: null,
      pos: { x: s.x + fx * 3.2, y: (s.y ?? 0) + 0.06, z: s.z + fz * 3.2 },
      timeLeft: 0,
    };
  }

  // 携带者死亡/离房：炸弹掉落在该位置
  dropBomb(p) {
    if (this.mode !== MODE.DEFUSAL || !p.bombCarrier) return;
    p.bombCarrier = false;
    if (!this.bomb) return;
    this.bomb.carried = false;
    this.bomb.carrierId = null;
    this.bomb.pos = { x: p.pos.x, y: (p.pos.y ?? 0) + 0.2, z: p.pos.z };
    this.broadcast({ type: 'bomb_dropped', pos: this.bomb.pos });
  }

  pickSpawn(teamKey) {
    const spots = this.map.spawns[teamKey] || this.map.spawns.HUMAN || [{ x: 0, z: 0, yaw: 0 }];
    const order = spots.map((_, i) => i).sort(() => Math.random() - 0.5);
    for (const i of order) {
      const s = spots[i];
      const taken = [...this.players.values()].some(
        (q) => q.alive && Math.hypot(q.pos.x - s.x, q.pos.z - s.z) < 2.2
      );
      if (!taken) return s;
    }
    return spots[order[0]];
  }

  spawnAll(opts = {}) {
    for (const p of this.players.values()) {
      const teamKey = p.isZombie ? 'ZOMBIE' : p.team === TEAM.CT ? 'CT' : p.team === TEAM.T ? 'T' : 'HUMAN';
      const spot = this.pickSpawn(teamKey);
      const keep = typeof opts.keepLoadout === 'function' ? !!opts.keepLoadout(p) : !!opts.keepLoadout;
      spawnPlayer(this, p, p.team, spot, { keepLoadout: keep });
    }
  }

  // 把玩家所有武器的弹药补满并重置时间状态（存活者跨局保留时使用）
  refillAmmo(p) {
    for (const w of p.weapons.values()) {
      w.reset(0);
      if (Number.isFinite(w.def.magSize)) w.ammo = w.def.magSize;
      if (Number.isFinite(w.def.reserve)) w.reserve = w.def.reserve;
    }
  }

  handleRoundEvent(e) {
    this.emit(e.type, e);
    if (e.type === 'round_start') {
      this.broadcast({ type: 'round_start', mode: this.mode, round: this.roundNum, ...e });
    } else if (e.type === 'round_end') {
      const winner = e.winner;
      const continuous = !this.modeCfg.rounds;
      const score = this.matchScore;
      // 军备竞赛的分数不是队伍分：把"等级"作为比分展示没有意义，这里只记局数
      if (this.mode === MODE.TDM) {
        if (this.matchScore[winner] !== undefined) this.matchScore[winner] += 1;
      } else if (this.mode === MODE.GUNGAME) {
        // 自由混战没有队伍分：胜负只看个人等级，见 snapshot 的 lv 字段
      } else if (winner === 'DRAW') {
        this.matchScore.HUMAN += 1;
        this.matchScore.ZOMBIE += 1;
      } else if (this.matchScore[winner] !== undefined) {
        this.matchScore[winner] += 1;
      }
      if (this.mode === MODE.DEFUSAL) {
        for (const p of this.players.values()) {
          const won = p.team === winner;
          p.money = Math.min(MONEY_CAP, p.money + (won ? WIN_REWARD : LOSS_REWARD));
        }
      }
      // 生化：每回合双方各记 1 分；拆弹：先到 8 分赢下整场；
      // 死斗/军备：单局即整场，round_end 直接等于 match_end。
      const isDraw = winner === 'DRAW';
      const matchWinner = continuous
        ? (isDraw ? 'DRAW' : winner)
        : isDraw
          ? null
          : this.mode === MODE.DEFUSAL
            ? (score[winner] >= ROUNDS_TO_WIN ? winner : null)
            : (score[winner] >= ROUNDS_TO_WIN && score[winner] > score[winner === 'HUMAN' ? 'ZOMBIE' : 'HUMAN'] ? winner : null);
      const nextRoundIn = continuous ? 8 : (matchWinner ? 5 : 10);
      if (this.mode === MODE.DEFUSAL) {
        this.phase = matchWinner ? 'over' : 'buy';
        this.buyUntil = matchWinner ? 0 : this.time + nextRoundIn;
      }
      if (continuous) {
        this.phase = 'over';
        this.roundEndAt = 0;
      } else {
        this.roundEndAt = this.time + nextRoundIn;
      }
      this.broadcast({
        type: 'round_end',
        winner,
        reason: e.reason,
        round: this.roundNum,
        scores: score,
        matchWinner,
        nextRoundIn,
        winnerId: e.winnerId,
        winnerName: e.winnerName,
        scoreLimit: this.modeCfg.scoreLimit,
      });
      if (matchWinner) {
        this.matchEndAt = this.time + 8;
        this.broadcast({ type: 'match_end', winner: matchWinner, scores: score, winnerId: e.winnerId, winnerName: e.winnerName });
      }
    } else if (e.type === 'bomb_planted') {
      this.bomb.planted = true;
      this.bomb.carried = false;
      this.bomb.carrierId = null;
      this.bomb.pos = e.pos;
      this.bomb.timeLeft = 40;
      this.broadcast({ type: 'bomb_planted', pos: e.pos, carrier: this.core?.bombCarrier });
    } else if (e.type === 'bomb_exploded') {
      this.broadcast({ type: 'bomb_exploded', pos: this.bomb.pos });
    } else if (e.type === 'bomb_defused') {
      this.broadcast({ type: 'bomb_defused', pos: this.bomb.pos });
    }
  }

  // ---------- 琉璃决战（生化模式最后 60 秒） ----------
  activateFinale() {
    const players = [...this.players.values()];
    const humans = players.filter((p) => p.alive && !p.isZombie);
    const zombies = players
      .filter((p) => p.alive && p.isZombie)
      .sort((a, b) => (a.zombieSince ?? 1e9) - (b.zombieSince ?? 1e9));
    // 所有存活人类 → 琉璃猎人
    for (const h of humans) {
      h.isCrystalHunter = true;
      h.hp = h.maxHp = FINALE.HUNTER_HP;
      h.armor = FINALE.HUNTER_ARMOR;
      h.damageMult = FINALE.HUNTER_DAMAGE;
      this.refillAmmo(h);
    }
    let king = null;
    let servants = 0;
    if (zombies.length) {
      // 最初始的丧尸 → 尸王
      king = zombies[0];
      king.isZombieKing = true;
      king.hp = king.maxHp = FINALE.KING_HP;
      king.armor = FINALE.KING_ARMOR;
      king.damageMult = FINALE.KING_DAMAGE;
      // 其余随机 3 只 → 尸仆
      const rest = zombies.slice(1).sort(() => Math.random() - 0.5);
      const servantCount = Math.min(3, rest.length);
      for (let i = 0; i < servantCount; i++) {
        const s = rest[i];
        s.isZombieServant = true;
        s.hp = s.maxHp = FINALE.SERVANT_HP;
        s.armor = FINALE.SERVANT_ARMOR;
        s.damageMult = FINALE.SERVANT_DAMAGE;
        servants += 1;
      }
      // 其余丧尸仅小幅提升血量
      for (const z of zombies) {
        if (z.isZombieKing || z.isZombieServant) continue;
        z.hp = z.maxHp = Math.ceil(z.maxHp * FINALE.ZOMBIE_HP_MULT);
        z.damageMult = 1;
      }
    }
    this.broadcast({ type: 'finale_start', hunters: humans.length, king: king?.name, servants });
    // 同步到本地事件总线（Mod / 服务端逻辑可监听；此前只广播给客户端）
    this.emit('finale_start', { hunters: humans.length, king: king?.name, servants, zombies: zombies.length });
    this.say(
      `琉璃之力觉醒！${humans.length} 名人类化为琉璃猎人` +
      (king ? `，${king.name} 化为尸王` : '') +
      (servants ? `，${servants} 只尸仆觉醒` : '') +
      `！最后 ${FINALE.DURATION} 秒不死不休，死亡不再复活！`
    );
  }

  // 生化模式丧尸加速技能（F 键）：20s 冷却，加速 3s
  triggerZombieBoost(p) {
    if (this.mode !== MODE.ZOMBIE || !p.isZombie || !p.alive) return false;
    if (this.time < (p.skillReadyAt || 0)) return false; // 冷却中
    p.speedOverride = ZOMBIE_BOOST_SPEED;
    p.boostUntil = this.time + ZOMBIE_BOOST_DURATION;
    p.skillReadyAt = this.time + ZOMBIE_BOOST_COOLDOWN;
    this.sendTo(p.id, { type: 'zombie_boost', cooldown: ZOMBIE_BOOST_COOLDOWN });
    this.broadcast({ type: 'zombie_boost_visual', id: p.id });
    return true;
  }

  // ---------- 主循环 ----------
  //
  // 计时用"真实经过时间 + 固定步长"的累加器，而不是"每次回调推进 1/30 秒"。
  // 浏览器在页面繁忙（低端手机、软件渲染、后台标签）时会明显降低 setInterval 频率，
  // 旧写法下 30Hz 回调变成 5Hz，整局游戏就以 1/6 速度慢放：回合 105 秒要跑十分钟，
  // 人物移动/射速也跟着变慢。改为按墙钟时间补步后，帧率再低也是实时速度，
  // 只是模拟精度下降（每次调用最多补 6 步，追不上就丢弃积压，避免雪崩）。
  tick() {
    // 离线单人时暂停：连时间一起冻结，复活计时/回合计时/炸弹倒计时都不会"偷偷走"
    if (this.paused) {
      this.lastTickAt = performance.now();
      return;
    }
    const now = performance.now();
    if (!this.lastTickAt) this.lastTickAt = now;
    let elapsed = (now - this.lastTickAt) / 1000;
    this.lastTickAt = now;
    if (elapsed > 0.6) elapsed = 0.6; // 切后台回来：最多补 0.6s
    this.acc = (this.acc || 0) + elapsed;
    const stepSec = TICK_MS / 1000;
    // 上限 12 步（0.4s）：低端机上 setInterval 会被压到 10~15Hz，
    // 上限太低会让对局整体慢放（实测 6 步只有 0.4 倍速）；过高则可能雪崩。
    let steps = 0;
    while (this.acc >= stepSec && steps < 12) {
      this.step(stepSec);
      this.acc -= stepSec;
      steps += 1;
    }
    if (steps >= 12) this.acc = 0; // 追不上就放弃积压，宁可慢一点也不要卡死
  }

  // 单步模拟（固定 dt）
  step(dt) {
    this.time += dt;
    this.tickAcc += TICK_MS;
    this.snapAcc += TICK_MS;

    if (this.matchEndAt && this.time >= this.matchEndAt) {
      this.matchScore = { CT: 0, T: 0, HUMAN: 0, ZOMBIE: 0 };
      this.matchEndAt = 0;
      this.roundEndAt = 0;
      this.resetEconomy();
      this.nextMap();
      if (this.mode === MODE.DEFUSAL) this.beginBuyPhase();
      else this.startRound();
      return;
    }
    if (this.roundEndAt && !this.matchEndAt && this.time >= this.roundEndAt) {
      this.startRound();
      return;
    }

    for (const p of this.players.values()) {
      if (!p.alive) {
        if (p.respawnAt && this.time >= p.respawnAt && !this.noRespawn) {
          if (this.mode === MODE.ZOMBIE) respawnZombie(this, p);
          else if (this.mode === MODE.TDM || this.mode === MODE.GUNGAME) this.respawnContinuous(p);
        }
        continue;
      }
      // 丧尸加速技能到期：恢复基础速度
      if (p.boostUntil && this.time >= p.boostUntil) {
        p.boostUntil = 0;
        p.speedOverride = undefined;
      }
      if (p.isBot) {
        tickBot(this, p);
        p.inputAt = this.time;
      }
      this.processInput(p);
      movePlayer(p, p.input, dt, this.map.colliders, { gravity: this.rules.gravity });
      if (p.history) {
        p.history.push(this.time, {
          pos: { ...p.pos },
          yaw: p.yaw,
          pitch: p.pitch,
          crouch: p.crouch,
          alive: true,
        });
        p.history.prune(this.time);
      }
      this.processWeapons(p);
      this.processUse(p, dt);
      if (p.isZombie && this.time - p.lastHitAt > 3) {
        p.hp = Math.min(p.maxHp, p.hp + PHYS.ZOMBIE_REGEN * dt);
        if (p.slowTicks > 0) p.slowTicks--;
      }
    }

    this.updateProjectiles(dt);
    this.core?.update(dt);
    // 军备竞赛到点：等级最高者（并列比击杀）夺冠
    if (this.mode === MODE.GUNGAME && this.core?.state === 'live' && this.core.timeLeft <= 0) {
      const ranked = [...this.players.values()].sort((a, b) =>
        ((b.ggLevel || 0) - (a.ggLevel || 0)) || (b.kills - a.kills) || (b.score - a.score));
      const best = ranked[0];
      this.core.end(best ? best.id : null, best ? best.name : null, 'timeout');
    }
    this.updateAmmoBoxes(dt);
    if (this.phase === 'buy' && this.mode === MODE.DEFUSAL) {
      for (const bot of this.players.values()) {
        if (bot.isBot && !bot.boughtPhase) {
          bot.boughtPhase = true;
          this.autoBuy(bot);
        }
      }
    }
    if (this.mode === MODE.ZOMBIE && this.core?.state === 'live') {
      const aliveHuman = [...this.players.values()].filter((p) => p.alive && !p.isZombie);
      const aliveZombie = [...this.players.values()].filter((p) => p.alive && p.isZombie);
      // 最后 60 秒：琉璃决战激活（全员变身、不再复活）
      // 注意：必须在胜负判定之前触发。旧顺序下"丧尸全灭"会先结束回合，
      // 导致决战在整个游戏生命周期内几乎不可能出现（实测 0/12）。
      if (!this.finaleActive && this.core.timeLeft <= FINALE.DURATION) {
        this.finaleActive = true;
        this.noRespawn = true;
        if (aliveHuman.length > 0 || aliveZombie.length > 0) this.activateFinale();
      }
      // 丧尸全灭时：决战阶段开始前给予一次"最后感染"补位，让决战有机会展开；
      // 决战已激活则按原逻辑由决战判定接管。
      if (!this.finaleActive && aliveZombie.length === 0 && aliveHuman.length > 0) {
        const pick = aliveHuman[Math.floor(Math.random() * aliveHuman.length)];
        pick.isZombie = true;
        pick.team = TEAM.ZOMBIE;
        pick.zombieSince = this.time;
        pick.hp = PHYS.ZOMBIE_HP;
        pick.maxHp = PHYS.ZOMBIE_HP;
        pick.armor = 0;
        pick.speedOverride = undefined;
        giveLoadout(pick, this.mode, TEAM.ZOMBIE);
        this.broadcast({ type: 'infected', id: pick.id });
        this.say(`${pick.name} 被选中为新僵尸！`);
      }
      if (this.finaleActive) {
        if (aliveZombie.length === 0 && aliveHuman.length === 0) {
          this.core.end('DRAW', 'mutual_annihilation');
        } else if (aliveZombie.length === 0) {
          this.core.end('HUMAN', 'zombies_eliminated');
        } else if (aliveHuman.length === 0) {
          this.core.end('ZOMBIE', 'infected_all');
        }
      } else if (aliveHuman.length === 0) {
        this.core.end('ZOMBIE', 'infected_all');
      }
    }

    if (this.snapAcc >= SNAPSHOT_INTERVAL_MS) {
      this.snapAcc = 0;
      this.broadcast(this.snapshot());
    }

    this.emit('tick', { time: this.time });
  }

  processInput(p) {
    const inp = p.input;
    // 服务器信任 Bot 输入，人类输入已在 index 校验
    p.crouch = inp.c ? 1 : 0;
    const slotBefore = p.activeSlot;
    // 边沿动作从累加器消费（人类输入可能被后续帧覆盖，tick 前不能只看最新状态）
    const edge = p.edge;
    if (Number.isInteger(edge.sw) && edge.sw >= 0) {
      if (p.weapons.has(edge.sw)) {
        p.activeSlot = edge.sw;
        p.useProgress = 0;
      } else {
        // 无效切枪（如无主武器时按 2）：立即回执当前武器，避免客户端乐观切枪后闪回
        const cur = p.weapons.get(p.activeSlot);
        p.switchSeq += 1;
        this.sendTo(p.id, { type: 'switch', w: cur?.def.id ?? '', slot: p.activeSlot, seq: p.switchSeq });
      }
    }
    if (edge.swd) {
      const slots = [...p.weapons.keys()].sort((a, b) => a - b);
      if (slots.length > 1) {
        const idx = slots.indexOf(p.activeSlot);
        const dir = edge.swd > 0 ? 1 : slots.length - 1;
        p.activeSlot = slots[(idx + dir) % slots.length];
        p.useProgress = 0;
      }
    }
    edge.sw = -1;
    edge.swd = 0;
    if (edge.j) {
      p.input.j = 1;
      edge.j = 0;
    }
    if (edge.r) {
      p.input.r = 1;
      edge.r = 0;
    }
    if (edge.skill) {
      edge.skill = 0;
      this.triggerZombieBoost(p);
    }
    // 切枪即时事件 + 序号：客户端据此忽略早于切枪的旧快照
    if (slotBefore !== p.activeSlot) {
      p.switchSeq += 1;
      this.sendTo(p.id, { type: 'switch', w: p.weapons.get(p.activeSlot)?.def.id, slot: p.activeSlot, seq: p.switchSeq });
    }
    const def = p.weapons.get(p.activeSlot)?.def;
    const ads = inp.ads && !p.isZombie && def && !def.melee && !def.projectile;
    p.weaponMoveMult = def ? def.moveMult * (ads ? 0.78 : 1) : 1;
    if (def?.projectile) {
      p.weaponMoveMult = Math.min(p.weaponMoveMult, 0.9);
    }
  }

  processWeapons(p) {
    const w = p.weapons.get(p.activeSlot);
    const held = !!p.input.fire;
    const fireNow = shouldFire(w?.def, held, !!p.wasFiring);
    p.wasFiring = held;
    if (!w) return;
    const def = w.def;
    const now = this.time;
    const reloadEvent = w.update(now);
    if (reloadEvent) {
      this.sendTo(p.id, { type: 'reloaded', ammo: reloadEvent.ammo, reserve: reloadEvent.reserve });
    }
    if (w.state === 'empty') {
      // 空弹匣自动换弹
      if (w.startReload(now).ok) this.sendTo(p.id, { type: 'reloading', weapon: def.id });
    } else if (p.input.r && w.state === 'ready' && w.ammo < w.def.magSize) {
      // 开火中按 R 也立即开始换弹
      if (w.startReload(now).ok) this.sendTo(p.id, { type: 'reloading', weapon: def.id });
    }
    if (fireNow && (!p.isZombie || def.melee)) {
      if (def.melee) {
        if (w.canFire(now)) {
          w.fire(now);
          performShot(this, p, def, { rewindTime: p.inputAt ?? this.time });
        }
      } else if (def.projectile) {
        if (w.canFire(now) && p.grenadeCount > 0) {
          w.fire(now);
          p.grenadeCount -= 1;
          performShot(this, p, def, { rewindTime: p.inputAt ?? this.time });
          this.sendTo(p.id, { type: 'throw_ack', grenades: p.grenadeCount });
        }
      } else if (w.canFire(now)) {
        w.fire(now);
        performShot(this, p, def, { rewindTime: p.inputAt ?? this.time });
        this.sendTo(p.id, { type: 'shot', weapon: def.id, ammo: w.ammo, reserve: w.reserve });
        this.broadcastShotFx(p, def);
      }
    }
    // 换弹是"按一次"的边沿动作：处理完立刻清掉，
    // 否则客户端某帧输入丢失时这个 1 会一直留在 p.input 里，导致打一发就自动换弹。
    p.input.r = 0;
  }

  // 广播开火表现（给除射手外的所有客户端）：弹道起点 + 方向 + 武器音效类型。
  // 之前只有射手自己收得到 shot 事件，别人开火既没有声音也没有曳光弹，
  // 等于"敌人枪声完全静音"，是 FPS 里最致命的听觉信息缺失。
  broadcastShotFx(p, def) {
    if (def.melee || def.projectile) return;
    const dir = directionFromAngles(p.yaw, p.pitch);
    const oy = eyeHeight(p);
    this.broadcast({
      type: 'shot_fx',
      id: p.id,
      w: def.id,
      s: def.sound || 'rifle',
      o: [+p.pos.x.toFixed(2), +oy.toFixed(2), +p.pos.z.toFixed(2)],
      d: [+dir.x.toFixed(3), +dir.y.toFixed(3), +dir.z.toFixed(3)],
      n: def.pellets ?? 1,
      ads: p.input?.ads ? 1 : 0,
    });
  }

  processUse(p, dt) {
    if (!p.input.u) {
      p.useProgress = 0;
      p.useTarget = null;
      return;
    }
    if (this.mode === MODE.DEFUSAL) {
      // 1) 拾取：T 方在未携带、未安放且在场的炸弹旁按 E → 成为携带者
      if (p.team === TEAM.T && !p.bombCarrier && this.bomb && !this.bomb.carried && !this.bomb.planted && this.bomb.pos) {
        const d = Math.hypot(p.pos.x - this.bomb.pos.x, p.pos.z - this.bomb.pos.z);
        if (d < 2.4) {
          p.bombCarrier = true;
          this.bomb.carried = true;
          this.bomb.carrierId = p.id;
          this.bomb.pos = null;
          this.sendTo(p.id, { type: 'bomb_pickup' });
          this.say(`${p.name} 拾取了炸弹`);
          p.useProgress = 0;
          p.useTarget = null;
          return;
        }
      }
      // 2) 安放：T 携带者在安放点按住 E，3 秒进度 + 滴答音
      if (p.team === TEAM.T && p.bombCarrier && !this.core?.bombPlanted) {
        const site = this.map.sites.find((s) => {
          const d = Math.hypot(p.pos.x - s.pos.x, p.pos.z - s.pos.z);
          return d < s.radius;
        });
        if (site) {
          p.useTarget = `plant_${site.id}`;
          p.useProgress += dt;
          if (p.useProgress >= 3) {
            this.core.plantBomb({ x: p.pos.x, y: p.pos.y, z: p.pos.z, site: site.id });
            this.bomb.planted = true;
            this.bomb.carried = false;
            this.bomb.carrierId = null;
            p.bombCarrier = false;
            p.money = Math.min(MONEY_CAP, p.money + PLANT_REWARD);
            p.useProgress = 0;
          }
        } else {
          p.useProgress = 0;
        }
        // 安放进度反馈（约 10Hz）
        if (p.useProgress > 0 && this.time - (p.lastUseProgressAt || 0) >= 0.1) {
          p.lastUseProgressAt = this.time;
          this.sendTo(p.id, { type: 'use_progress', action: 'plant', progress: Math.min(1, +(p.useProgress / 3).toFixed(2)) });
        }
        return;
      }
      // 3) 拆除：CT 且炸弹已安放
      if (p.team === TEAM.CT && this.core?.bombPlanted) {
        const d = Math.hypot(p.pos.x - this.bomb.pos.x, p.pos.z - this.bomb.pos.z);
        if (d < 2.4) {
          p.useTarget = 'defuse';
          p.useProgress += dt;
          if (p.useProgress >= 5) {
            this.core.defuseBomb();
            p.money = Math.min(MONEY_CAP, p.money + DEFUSE_REWARD);
            p.useProgress = 0;
          }
        } else {
          p.useProgress = 0;
        }
        // 拆除进度反馈（约 10Hz）
        if (p.useProgress > 0 && this.time - (p.lastUseProgressAt || 0) >= 0.1) {
          p.lastUseProgressAt = this.time;
          this.sendTo(p.id, { type: 'use_progress', action: 'defuse', progress: Math.min(1, +(p.useProgress / 5).toFixed(2)) });
        }
        return;
      }
      p.useProgress = 0;
      p.useTarget = null;
    } else if (!p.isZombie) {
      const box = this.ammoBoxes.find((b) => b.available && Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z) < 2);
      if (box) {
        let refilled = false;
        for (const w of p.weapons.values()) {
          if (w.def.reserve !== Infinity && w.reserve < w.def.reserve) {
            w.reserve = w.def.reserve;
            refilled = true;
          }
        }
        if (refilled) {
          box.available = false;
          box.respawnAt = this.time + box.respawn;
          this.sendTo(p.id, { type: 'ammo_refill' });
          this.broadcast({ type: 'ammo_box', id: p.id, pos: box.pos });
          p.useProgress = 1;
          this.sendTo(p.id, { type: 'use_progress', action: 'supply', progress: 1 });
        }
      }
      // 回血箱：人类接近按住 E 回复生命（进度条给一次满格反馈）
      if (p.hp < p.maxHp) {
        const hb = this.healthBoxes.find((b) => b.available && Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z) < 2);
        if (hb) {
          const before = p.hp;
          p.hp = Math.min(p.maxHp, p.hp + HEALTH_BOX_HEAL);
          hb.available = false;
          hb.respawnAt = this.time + hb.respawn;
          this.sendTo(p.id, { type: 'health_refill', hp: Math.ceil(p.hp) });
          this.broadcast({ type: 'health_box', id: p.id, pos: hb.pos, amount: Math.round(p.hp - before) });
          p.useProgress = 1;
          this.sendTo(p.id, { type: 'use_progress', action: 'supply', progress: 1 });
        }
      }
      p.useTarget = p.useProgress ? 'supply' : null;
    }
  }

  updateProjectiles(dt) {
    for (const proj of [...this.projectiles]) {
      proj.fuse -= dt;
      proj.vel.y += -9.8 * dt;
      const next = {
        x: proj.pos.x + proj.vel.x * dt,
        y: proj.pos.y + proj.vel.y * dt,
        z: proj.pos.z + proj.vel.z * dt,
      };
      let bounced = false;
      for (const box of this.map.colliders) {
        if (
          next.x > box.min.x && next.x < box.max.x &&
          next.y > box.min.y && next.y < box.max.y &&
          next.z > box.min.z && next.z < box.max.z
        ) {
          const penX = Math.min(next.x - box.min.x, box.max.x - next.x);
          const penY = Math.min(next.y - box.min.y, box.max.y - next.y);
          const penZ = Math.min(next.z - box.min.z, box.max.z - next.z);
          const min = Math.min(penX, penY, penZ);
          if (min === penY && proj.vel.y > 0) proj.vel.y *= -0.4;
          else if (min === penY) proj.vel.y *= -0.4;
          else if (min === penX) proj.vel.x *= -0.4;
          else proj.vel.z *= -0.4;
          proj.bounces++;
          bounced = true;
          break;
        }
      }
      if (bounced) {
        proj.pos = {
          x: (proj.pos.x + next.x) / 2,
          y: (proj.pos.y + next.y) / 2,
          z: (proj.pos.z + next.z) / 2,
        };
        if (proj.bounces >= 3 || Math.hypot(proj.vel.x, proj.vel.y, proj.vel.z) < 1.2) proj.vel = { x: 0, y: 0, z: 0 };
      } else {
        proj.pos = next;
      }
      if (proj.pos.y < 0.1) {
        proj.pos.y = 0.1;
        proj.vel.y *= -0.35;
      }
      if (proj.fuse <= 0) {
        this.explodeGrenade(proj);
        this.projectiles.splice(this.projectiles.indexOf(proj), 1);
      }
    }
  }

  explodeGrenade(proj) {
    const def = this.weapons.get('thunder');
    this.broadcast({ type: 'explosion', pos: proj.pos, owner: proj.owner });
    this.emit('explosion', { pos: proj.pos, owner: proj.owner });
    const owner = this.players.get(proj.owner);
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const dx = p.pos.x - proj.pos.x;
      const dy = p.pos.y + 0.9 - proj.pos.y;
      const dz = p.pos.z - proj.pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 11) continue;
      const dmg = def.damage * (d <= 3 ? 1 : 1 - ((d - 3) / 8) * 0.75);
      damagePlayer(this, owner, p, Math.round(dmg), { weapon: 'thunder', dist: d });
    }
  }

  updateAmmoBoxes(dt) {
    for (const b of this.ammoBoxes) {
      if (!b.available && this.time >= b.respawnAt) b.available = true;
    }
    for (const b of this.healthBoxes) {
      if (!b.available && this.time >= b.respawnAt) b.available = true;
    }
  }

  // ---------- 经济 / 购买 ----------
  handleBuy(p, item) {
    if (this.mode !== MODE.DEFUSAL || this.phase !== 'buy') return { ok: false, reason: 'phase' };
    if (!p) return { ok: false, reason: 'player' };
    const cost = costOf(item, p);
    if (cost < 0) return { ok: false, reason: 'item' };
    if (cost === 0) return { ok: false, reason: 'already' };
    if (p.money < cost) return { ok: false, reason: 'money' };
    if (item === 'armor') {
      p.boughtItems.push({ item, cost, prevArmor: p.armor });
      p.armor = 100;
    } else if (item === 'grenade') {
      if (p.grenadeCount >= 5) return { ok: false, reason: 'max' };
      p.grenadeCount += 1;
      p.boughtItems.push({ item, cost });
    } else {
      const def = this.weapons.get(item);
      if (!def) return { ok: false, reason: 'item' };
      const prev = p.weapons.get(def.slot) || null;
      const runtime = new WeaponRuntime(def);
      p.weapons.set(def.slot, runtime);
      p.boughtItems.push({ item, cost, slot: def.slot, prev, runtime });
      if (def.slot === 2) p.activeSlot = 2;
    }
    p.money -= cost;
    this.sendTo(p.id, { type: 'buy_ok', item, money: p.money });
    return { ok: true };
  }

  handleRefund(p, item) {
    if (this.mode !== MODE.DEFUSAL || this.phase !== 'buy') return { ok: false, reason: 'phase' };
    if (!p) return { ok: false, reason: 'player' };
    const idx = p.boughtItems.findIndex((r) => r.item === item);
    if (idx < 0) return { ok: false, reason: 'not_bought' };
    const rec = p.boughtItems[idx];
    if (item === 'armor') {
      p.armor = rec.prevArmor;
    } else if (item === 'grenade') {
      p.grenadeCount = Math.max(0, p.grenadeCount - 1);
    } else if (p.weapons.get(rec.slot) === rec.runtime) {
      if (rec.prev) p.weapons.set(rec.slot, rec.prev);
      else p.weapons.delete(rec.slot);
      if (!rec.prev && p.activeSlot === rec.slot && p.weapons.has(1)) p.activeSlot = 1;
    }
    // 若该武器已被后续购买覆盖，则只退钱不退枪
    p.money = Math.min(MONEY_CAP, p.money + rec.cost);
    p.boughtItems.splice(idx, 1);
    this.sendTo(p.id, { type: 'refund_ok', item, money: p.money });
    return { ok: true };
  }

  autoBuy(bot) {
    // 循环买齐：主武器 → 护甲 → 手雷（余额允许时）。
    // 旧实现每回合只买一件（买完主武器就 return），Bot 永远没有护甲和手雷，
    // 打到中后期人类玩家随便一枪就能带走，房间难度直线下降。
    let bought = 0;
    for (let guard = 0; guard < 4; guard++) {
      if (!bot.weapons.has(2)) {
        const order = ['longshot', 'bruiser', 'arc17', 'warden', 'vx9'];
        const pick = order.find((id) => bot.money >= PRICES[id]);
        if (pick) { this.handleBuy(bot, pick); bought++; continue; }
      } else if (bot.armor < 60 && bot.money >= PRICES.armor) {
        this.handleBuy(bot, 'armor');
        bought++;
        continue;
      } else if (bot.grenadeCount < 2 && bot.money >= PRICES.grenade) {
        this.handleBuy(bot, 'grenade');
        bought++;
        continue;
      }
      break;
    }
    return bought ? { ok: true } : { ok: false };
  }

  // 生化模式选枪：随时可打开（B），人类选择一把主武器并立即装备（重生后保持）
  // 另支持护甲 / 手雷：生化模式没有购买阶段，若不开放这两项，人类的 1000 初始资金
  // 只能买枪，护甲永远停在出生时的 50，面对尸爪几乎没有容错。
  handleZombieSelect(p, item) {
    if (this.mode !== MODE.ZOMBIE) return { ok: false, reason: 'phase' };
    if (!p || p.isZombie) return { ok: false, reason: 'player' };
    if (item === 'armor') {
      if (p.armor >= 100) return { ok: false, reason: 'already' };
      if (p.money < PRICES.armor) return { ok: false, reason: 'money' };
      p.money -= PRICES.armor;
      p.armor = 100;
      this.sendTo(p.id, { type: 'buy_ok', item, money: p.money });
      this.sendTo(p.id, { type: 'zselect_ok', item, money: p.money });
      return { ok: true };
    }
    if (item === 'grenade') {
      if (p.grenadeCount >= 5) return { ok: false, reason: 'max' };
      if (p.money < PRICES.grenade) return { ok: false, reason: 'money' };
      p.money -= PRICES.grenade;
      p.grenadeCount += 1;
      this.sendTo(p.id, { type: 'buy_ok', item, money: p.money });
      this.sendTo(p.id, { type: 'zselect_ok', item, money: p.money });
      return { ok: true };
    }
    const def = this.weapons.get(item);
    if (!def || def.slot !== 2) return { ok: false, reason: 'item' };
    const cost = weaponPrice(def);
    if (p.money < cost) return { ok: false, reason: 'money' };
    p.weapons.set(2, new WeaponRuntime(def));
    p.selectedPrimary = def.id;
    p.money -= cost;
    p.activeSlot = 2;
    this.sendTo(p.id, { type: 'buy_ok', item, money: p.money });
    this.sendTo(p.id, { type: 'zselect_ok', item, money: p.money });
    return { ok: true };
  }

  resetEconomy() {
    for (const p of this.players.values()) {
      if (this.mode === MODE.ZOMBIE) {
        // 生化模式无购买阶段：整场结束后给所有人重置到初始资金
        p.money = ZOMBIE_START_MONEY;
      } else {
        p.money = START_MONEY;
        p.boughtItems = [];
      }
    }
    this.phase = 'live';
    this.buyUntil = 0;
  }

  beginBuyPhase() {
    if (this.mode !== MODE.DEFUSAL) return;
    this.phase = 'buy';
    this.buyUntil = this.time + 10;
    this.roundEndAt = this.time + 10;
    this.broadcast({ type: 'buy_phase', until: this.buyUntil });
    this.log('buy phase started');
  }

  nextMap() {
    this.rotationIdx = (this.rotationIdx + 1) % this.rotation.length;
    this.mapId = this.rotation[this.rotationIdx];
    this.map = MAPS[this.mapId];
    this.ammoBoxes = (this.map.ammoBoxes || []).map((b) => ({ ...b, available: true, respawnAt: 0 }));
    this.healthBoxes = (this.map.healthBoxes || []).map((b) => ({ ...b, available: true, respawnAt: 0 }));
    this.broadcast({ type: 'map_change', map: this.mapId, mapName: this.map.name });
    this.log(`next map: ${this.mapId}`);
  }

  // ---------- 快照 ----------
  snapshot() {
    const players = [];
    for (const p of this.players.values()) {
      const w = p.weapons.get(p.activeSlot);
      players.push({
        i: p.id,
        n: p.name.slice(0, 12),
        t: p.team,
        zb: p.isZombie ? 1 : 0,
        h: Math.max(0, Math.ceil(p.hp)),
        mx: Math.max(1, Math.ceil(p.maxHp)),
        a: Math.max(0, Math.ceil(p.armor)),
        ft: p.isCrystalHunter ? 1 : p.isZombieKing ? 2 : p.isZombieServant ? 3 : 0,
        x: +p.pos.x.toFixed(2),
        y: +p.pos.y.toFixed(2),
        z: +p.pos.z.toFixed(2),
        ya: +p.yaw.toFixed(3),
        pi: +p.pitch.toFixed(3),
        al: p.alive ? 1 : 0,
        cr: p.crouch ? 1 : 0,
        w: w?.def.id ?? '',
        am: Math.min(w?.ammo ?? 0, 999),
        rs: Math.min(w?.reserve ?? 0, 9999),
        bc: p.bombCarrier ? 1 : 0,
        ws: p.switchSeq,
        sc: p.score,
        k: p.kills,
        d: p.deaths,
        g: p.grenadeCount,
        mo: p.money,
        bi: p.boughtItems.map((r) => r.item),
        // 技能冷却（秒）：必须用独立字段，曾经误用 sc 覆盖了得分
        sk: Math.max(0, Math.ceil((p.skillReadyAt || 0) - this.time)),
        bo: p.boostUntil && this.time < p.boostUntil ? 1 : 0,
        // 复活倒计时（秒）：-1 表示本回合不再复活（拆弹阵亡 / 决战阵亡）
        ra: p.alive ? 0 : (p.respawnAt ? Math.max(0, Math.ceil(p.respawnAt - this.time)) : -1),
        // 出生保护（1=无敌中）：客户端可以据此提示/描边
        sp: p.spawnProtectUntil && this.time < p.spawnProtectUntil ? 1 : 0,
        // 军备竞赛等级（0 起）；其他模式恒为 0
        lv: p.ggLevel || 0,
      });
    }
    const r = {
      st: this.core?.state ?? this.state,
      rn: this.roundNum,
      tl: Math.max(0, Math.ceil(this.core?.timeLeft ?? 0)),
      bl: Math.max(0, Math.ceil(this.bomb.timeLeft ?? 0)),
      sc: this.mode === MODE.TDM ? (this.core?.scores || this.matchScore) : this.matchScore,
      sl: this.modeCfg.scoreLimit || 0,
      ph: this.phase,
      bu: Math.max(0, Math.ceil(this.buyUntil - this.time)),
    };
    return {
      type: S2C.STATE,
      t: +this.time.toFixed(2),
      p: players,
      b: (() => {
        const b = this.bomb;
        if (!b) return null;
        if (b.planted) {
          return { planted: 1, carried: 0, x: b.pos.x, y: b.pos.y, z: b.pos.z, tl: Math.max(0, Math.ceil(this.core?.bombTimeLeft ?? 0)) };
        }
        if (b.carried) return { carried: 1, carrierId: b.carrierId, planted: 0 };
        if (b.pos) return { planted: 0, carried: 0, x: b.pos.x, y: b.pos.y, z: b.pos.z };
        return null;
      })(),
      proj: this.projectiles.map((pr) => ({ id: pr.id, x: +pr.pos.x.toFixed(2), y: +pr.pos.y.toFixed(2), z: +pr.pos.z.toFixed(2), k: pr.kind })),
      r,
    };
  }

  handleModMessage(playerId, msg) {
    this.emit('client_message', { playerId, type: msg.type, payload: msg.payload, room: this });
  }
}
