// 房间：固定步长模拟、模式编排、输入处理、武器/投掷物/快照/事件总线。

import { TICK_RATE, TICK_MS, SNAPSHOT_INTERVAL_MS, TEAM, S2C, EVENT, PHYS, MODE, FINALE, HEALTH_BOX_HEAL } from '../shared/constants.js';
import { BUILTIN_WEAPONS, WeaponRuntime, shouldFire } from '../shared/weapons.js';
import { PRICES, START_MONEY, MONEY_CAP, WIN_REWARD, LOSS_REWARD, PLANT_REWARD, DEFUSE_REWARD, costOf, ZOMBIE_START_MONEY, weaponPrice } from '../shared/economy.js';
import { MAPS } from '../shared/maps/index.js';
import { movePlayer } from '../shared/physics.js';
import { createPlayer, spawnPlayer, damagePlayer, killPlayer, respawnZombie, giveLoadout } from './player.js';
import { performShot } from './hitscan.js';
import { tickBot, createBotBrain } from './bots.js';
import { loadServerMods } from './mods.js';
import { DefusalRound } from './modes/defusal-core.js';
import { ZombieMatch } from './modes/zombie-core.js';

const BOT_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet'];

export class Room {
  constructor({ id, mode, mapId, maxPlayers = 12, botCount = 8, config = {} }) {
    this.id = id;
    this.mode = mode;
    this.mapId = mapId;
    this.map = MAPS[mapId];
    this.maxPlayers = maxPlayers;
    this.botCount = botCount;
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
    this.rotation = mode === 'defusal' ? ['vertex', 'obsidian'] : ['containment', 'obsidian'];
    this.rotationIdx = 0;
    this.modResults = { loaded: [], errors: [] };
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

  // ---------- 玩家管理 ----------
  addPlayer(name, teamPref = 'random') {
    if (this.humans() >= this.maxPlayers) return null;
    const id = `h${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    const p = createPlayer(id, name);
    p.teamPref = teamPref === 'ct' || teamPref === 't' ? teamPref : 'random';
    if (this.mode === MODE.DEFUSAL) {
      // 加入时立即分配阵营（偏好优先，随机则补弱），购买阶段即可见
      if (p.teamPref === 't') p.team = TEAM.T;
      else if (p.teamPref === 'ct') p.team = TEAM.CT;
      else {
        const ct = [...this.players.values()].filter((x) => x.team === TEAM.CT).length;
        const t = [...this.players.values()].filter((x) => x.team === TEAM.T).length;
        p.team = ct <= t ? TEAM.CT : TEAM.T;
      }
    }
    this.players.set(id, p);
    // 若房间满员，挤掉最后一个 bot
    if (this.players.size > this.maxPlayers) {
      const bot = [...this.players.values()].reverse().find((x) => x.isBot);
      if (bot) this.players.delete(bot.id);
    }
    this.log(`player joined: ${name} (${id}), total=${this.players.size}`);
    return p;
  }

  spawnJoiner(p) {
    if (!this.core) return; // 开局购买阶段：队伍已在加入时分配
    if (this.core.state === 'ended') return;
    if (p.alive) return; // 已在本回合出生（如开局加入）则不动，避免清掉炸弹携带者
    if (this.mode === MODE.DEFUSAL) {
      p.isZombie = false;
      if (p.teamPref === 't') p.team = TEAM.T;
      else if (p.teamPref === 'ct') p.team = TEAM.CT;
      else {
        const ct = [...this.players.values()].filter((x) => x.team === TEAM.CT).length;
        const t = [...this.players.values()].filter((x) => x.team === TEAM.T).length;
        p.team = ct <= t ? TEAM.CT : TEAM.T;
      }
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

    if (this.mode === MODE.DEFUSAL) {
      // 记录上一回合是否存活（进入购买阶段时不会复活，round_start 前 alive 即存活状态）
      const survived = new Map();
      for (const p of all) survived.set(p.id, p.alive);
      const players = all.filter((p) => !p.isBot || true);
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
      const zombieCount = Math.max(1, Math.min(3, Math.floor(all.length * 0.2), all.length));
      const pool = [...all].sort(() => Math.random() - 0.5);
      for (let i = 0; i < zombieCount; i++) {
        pool[i].isZombie = true;
        pool[i].team = TEAM.ZOMBIE;
      }
      this.spawnAll();
      this.core = new ZombieMatch({
        duration: 300,
        onEvent: (e) => this.handleRoundEvent(e),
      });
      const humans = [...all].filter((p) => !p.isZombie);
      const zombies = [...all].filter((p) => p.isZombie);
      this.core.start({ humans: humans.map((p) => p.id), zombies: zombies.map((p) => p.id) });
    }
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
      if (this.mode === MODE.DEFUSAL) {
        this.matchScore[winner] += 1;
        for (const p of this.players.values()) {
          const won = p.team === winner;
          p.money = Math.min(MONEY_CAP, p.money + (won ? WIN_REWARD : LOSS_REWARD));
        }
        const matchWinner = this.matchScore[winner] >= 8 ? winner : null;
        this.phase = matchWinner ? 'over' : 'buy';
        this.buyUntil = matchWinner ? 0 : this.time + 10;
        this.roundEndAt = this.time + (matchWinner ? 5 : 10);
        this.broadcast({ type: 'round_end', winner, reason: e.reason, round: this.roundNum, scores: this.matchScore, matchWinner, nextRoundIn: matchWinner ? 5 : 10 });
        if (matchWinner) {
          this.matchEndAt = this.time + 8;
          this.broadcast({ type: 'match_end', winner: matchWinner, scores: this.matchScore });
        }
      } else {
        const matchWinner = e.winner;
        if (e.winner === 'DRAW') {
          this.matchScore.HUMAN += 1;
          this.matchScore.ZOMBIE += 1;
        } else {
          this.matchScore[e.winner] += 1;
        }
        this.broadcast({ type: 'round_end', winner, reason: e.reason, round: this.roundNum, scores: this.matchScore, matchWinner });
        this.matchEndAt = this.time + 8;
        this.roundEndAt = this.time + 5;
        this.broadcast({ type: 'match_end', winner: matchWinner, scores: this.matchScore });
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
    this.say(
      `琉璃之力觉醒！${humans.length} 名人类化为琉璃猎人` +
      (king ? `，${king.name} 化为尸王` : '') +
      (servants ? `，${servants} 只尸仆觉醒` : '') +
      `！最后 ${FINALE.DURATION} 秒不死不休，死亡不再复活！`
    );
  }

  // ---------- 主循环 ----------
  tick() {
    const dt = TICK_MS / 1000;
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
        if (p.respawnAt && this.time >= p.respawnAt && this.mode === MODE.ZOMBIE && !this.noRespawn) {
          respawnZombie(this, p);
        }
        continue;
      }
      if (p.isBot) tickBot(this, p);
      if (p.isBot) p.inputAt = this.time;
      this.processInput(p);
      movePlayer(p, p.input, dt, this.map.colliders);
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
      if (!this.finaleActive && this.core.timeLeft <= FINALE.DURATION) {
        this.finaleActive = true;
        this.noRespawn = true;
        if (aliveHuman.length > 0 || aliveZombie.length > 0) this.activateFinale();
      }
      if (this.finaleActive) {
        if (aliveZombie.length === 0 && aliveHuman.length === 0) {
          this.core.end('DRAW', 'mutual_annihilation');
        } else if (aliveZombie.length === 0) {
          this.core.end('HUMAN', 'zombies_eliminated');
        } else if (aliveHuman.length === 0) {
          this.core.end('ZOMBIE', 'infected_all');
        }
      } else {
        if (aliveHuman.length === 0) this.core.end('ZOMBIE', 'infected_all');
        if (aliveZombie.length === 0 && aliveHuman.length > 0) {
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
      }
    }
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
        }
      }
      // 回血箱：人类接近按住 E 回复生命
      if (p.hp < p.maxHp) {
        const hb = this.healthBoxes.find((b) => b.available && Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z) < 2);
        if (hb) {
          const before = p.hp;
          p.hp = Math.min(p.maxHp, p.hp + HEALTH_BOX_HEAL);
          hb.available = false;
          hb.respawnAt = this.time + hb.respawn;
          this.sendTo(p.id, { type: 'health_refill', hp: Math.ceil(p.hp) });
          this.broadcast({ type: 'health_box', id: p.id, pos: hb.pos, amount: Math.round(p.hp - before) });
        }
      }
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
    // 先买买得起的主武器（优先更好更贵的），没主武器才买
    if (!bot.weapons.has(2)) {
      const order = ['longshot', 'bruiser', 'arc17', 'warden', 'vx9'];
      for (const id of order) {
        if (bot.money >= PRICES[id]) return this.handleBuy(bot, id);
      }
    }
    if (bot.money >= PRICES.armor && bot.armor < 60) return this.handleBuy(bot, 'armor');
    if (bot.money >= PRICES.grenade && bot.grenadeCount < 2) return this.handleBuy(bot, 'grenade');
    return { ok: false };
  }

  // 生化模式选枪：随时可打开（B），人类选择一把主武器并立即装备（重生后保持）
  handleZombieSelect(p, item) {
    if (this.mode !== MODE.ZOMBIE) return { ok: false, reason: 'phase' };
    if (!p || p.isZombie) return { ok: false, reason: 'player' };
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
    for (const p of this.players.values()) p.money = START_MONEY;
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
      });
    }
    const r = {
      st: this.core?.state ?? this.state,
      rn: this.roundNum,
      tl: Math.max(0, Math.ceil(this.core?.timeLeft ?? 0)),
      bl: Math.max(0, Math.ceil(this.bomb.timeLeft ?? 0)),
      sc: this.matchScore,
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
