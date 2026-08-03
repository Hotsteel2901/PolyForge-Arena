// Bot：BFS 导航寻路 + 索敌交火 + 目标行为（安放/拆除/拾取/追逃/回血）。

import { TEAM } from '../shared/constants.js';
import { distance, angLerp } from '../shared/math.js';
import { traceWorld } from './hitscan.js';

export function createBotBrain() {
  return {
    goal: null,
    bombGoal: false,
    path: [],
    nextNode: null,
    decideAt: 0,
    strafeDir: 1,
    strafeAt: 0,
    attackAt: 0,
    burstUntil: 0,
    lastNodes: [],
    target: null,
    aimErrX: 0,       // 瞄准误差（持续小漂移，避免“锁头”死锁）
    aimErrY: 0,
    aimRefreshAt: 0,
  };
}

export function tickBot(room, bot) {
  const b = bot.botBrain;
  const input = bot.input;
  // 卡住检测：先记录上一帧的移动意图（随后输入会被重置）
  const wantsMove = bot.input.mv[0] || bot.input.mv[1] || bot.input.mv[2] || bot.input.mv[3];
  const moved = b.lastPos ? distance(bot.pos, b.lastPos) : 0;
  b.lastPos = { x: bot.pos.x, y: bot.pos.y, z: bot.pos.z };

  input.mv = [0, 0, 0, 0];
  input.j = 0;
  input.fire = 0;
  input.r = 0;
  input.u = 0;
  input.s = 0;
  input.c = 0;
  input.ads = 0;
  input.sw = -1;
  input.swd = 0;
  bot.edge.sw = -1;
  bot.edge.swd = 0;

  if (!bot.alive) return;

  if (wantsMove && moved < 0.1) {
    b.stuckFor = (b.stuckFor || 0) + 1 / 30;
    const now2 = room.time;
    if (b.stuckFor > 0.8) {
      // 贴墙滑动：左右横移交替；长时间无进展才跳+转向+重新寻路
      if (!b.slideUntil || now2 >= b.slideUntil) {
        b.slideDir = b.slideDir === 1 ? -1 : 1;
        b.slideUntil = now2 + 0.55;
      }
      if (b.slideDir === 1) input.mv[3] = 1;
      else input.mv[2] = 1;
      if (b.stuckFor > 2.6) {
        b.stuckFor = 0;
        input.j = 1;
        // 解锁：朝向目标方向（而非随机转向），减少贴墙空转
        const way = b.nextNode || b.goal;
        if (way) bot.yaw = Math.atan2(-(way.x - bot.pos.x), -(way.z - bot.pos.z));
        else bot.yaw += (Math.random() - 0.5) * 1.2;
        b.path = [];
        b.nextNode = null;
        b.decideAt = 0;
        b.slideUntil = now2 + 1.2;
      }
    }
  } else {
    // 缓慢衰减而非清零：抖动/跳动的小位移不会反复重置卡住计数
    b.stuckFor = Math.max(0, (b.stuckFor || 0) - 0.05);
  }

  const enemy = findEnemy(room, bot);
  const now = room.time;

  // 决策刷新：路径走完或目标改变时才重新规划（间隔 1.2~2.4s）
  if (now >= b.decideAt) {
    b.decideAt = now + 1.2 + Math.random() * 1.2;
    b.target = enemy;
    const prevGoal = b.goal;
    // 目标粘滞：拆弹模式选定点位后一路走到；CT 在炸弹安放后改去拆弹；T 有实体炸弹时优先去拾取
    if (room.mode === 'defusal') {
      const bombPlanted = room.core?.bombPlanted && room.bomb?.pos;
      const needPickup = bot.team === TEAM.T && !bot.bombCarrier && room.bomb && !room.bomb.planted && room.bomb.pos;
      if (bot.team === TEAM.CT && bombPlanted) {
        b.goal = { x: room.bomb.pos.x, z: room.bomb.pos.z, y: room.bomb.pos.y ?? 0 };
        b.bombGoal = true;
      } else if (needPickup) {
        // 持弹者死亡掉弹后，T 机器人必须始终优先去捡（覆盖已粘滞的点位目标）
        b.goal = { x: room.bomb.pos.x, z: room.bomb.pos.z, y: room.bomb.pos.y ?? 0 };
        b.bombGoal = true;
      } else if (!b.goal || b.bombGoal) {
        // 点位目标永久粘滞：到位后驻守，不重新随机换点
        b.bombGoal = false;
        b.goal = chooseGoal(room, bot);
      }
    } else {
      b.goal = chooseGoal(room, bot);
    }
    const goalChanged = !prevGoal || prevGoal.x !== b.goal.x || prevGoal.z !== b.goal.z;
    if (goalChanged || b.path.length === 0) {
      b.path = planPath(room.map, bot, b.goal);
      if (b.path.length === 0 && b.goal) {
        // 寻路失败：先跳到一个中间导航点再走
        const nav = room.map.nav;
        if (nav.length) {
          const mid = nav[Math.floor(Math.random() * nav.length)];
          b.goal = { x: mid.x, z: mid.z, y: mid.y ?? 0 };
          b.path = planPath(room.map, bot, b.goal);
        }
      }
      b.nextNode = null;
    }
    b.lastNodes = [];
  } else if (enemy) {
    b.target = enemy;
  }

  const distEnemy = enemy ? distance(bot.pos, enemy.pos) : Infinity;
  const visible = enemy ? hasLOS(room, bot, enemy) : false;

  if (enemy && visible && distEnemy < 45) {
    engage(room, bot, enemy, distEnemy);
  } else {
    moveAlongPath(room, bot, b);
  }

  // 行为动作：安放/拆除/弹药箱
  handleObjective(room, bot);
}

function findEnemy(room, bot) {
  let best = null;
  let bestD = Infinity;
  for (const p of room.players.values()) {
    if (p === bot || !p.alive) continue;
    const hostile = room.mode === 'zombie'
      ? p.isZombie !== bot.isZombie
      : p.team !== bot.team;
    if (!hostile) continue;
    const d = distance(bot.pos, p.pos);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function hasLOS(room, from, to) {
  // 直接朝敌人方向做视线检测（不依赖当前朝向），避免 Bot 明明看得到却不开火
  const origin = { x: from.pos.x, y: from.pos.y + 1.55, z: from.pos.z };
  const dx = to.pos.x - origin.x;
  const dy = to.pos.y + 1.3 - origin.y;
  const dz = to.pos.z - origin.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  const dir = { x: dx / len, y: dy / len, z: dz / len };
  const max = distance(from.pos, to.pos);
  const t = traceWorld(room.map, origin, dir, max);
  return t >= max - 0.3;
}

function chooseGoal(room, bot) {
  if (room.mode === 'defusal') {
    if (bot.team === TEAM.T) {
      if (bot.bombCarrier) {
        const site = room.map.sites[Math.floor(Math.random() * room.map.sites.length)];
        return { x: site.pos.x, z: site.pos.z, y: site.pos.y ?? 0, site };
      }
      const site = room.map.sites[Math.random() < 0.5 ? 0 : 1];
      return { x: site.pos.x, z: site.pos.z, y: site.pos.y ?? 0, site };
    }
    if (room.core?.bombPlanted && room.bomb?.pos) {
      return { x: room.bomb.pos.x, z: room.bomb.pos.z, y: room.bomb.pos.y ?? 0 };
    }
    const site = room.map.sites[Math.random() < 0.5 ? 0 : 1];
    return { x: site.pos.x, z: site.pos.z, y: site.pos.y ?? 0, site };
  }
  if (!bot.isZombie && bot.hp < bot.maxHp * 0.5) {
    // 人类血量过低：优先去最近的可用回血箱
    const avail = (room.healthBoxes || []).filter((b) => b.available);
    if (avail.length) {
      let best = avail[0];
      let bestD = Infinity;
      for (const b of avail) {
        const d = distance(bot.pos, { x: b.pos.x, y: 0, z: b.pos.z });
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
      return { x: best.pos.x, z: best.pos.z, y: best.pos.y ?? 0 };
    }
  }
  if (bot.isZombie) {
    const human = [...room.players.values()].find((p) => p.alive && !p.isZombie);
    return human ? { x: human.pos.x, z: human.pos.z, y: human.pos.y } : { x: 0, z: 0, y: 0 };
  }
  const zombie = [...room.players.values()].find((p) => p.alive && p.isZombie);
  if (zombie) {
    const d = distance(bot.pos, zombie.pos);
    if (d < 14) return { x: bot.pos.x * 2 - zombie.pos.x, z: bot.pos.z * 2 - zombie.pos.z, y: bot.pos.y }; // 逃跑
    return { x: zombie.pos.x, z: zombie.pos.z, y: zombie.pos.y };
  }
  return { x: 0, z: 0, y: 0 };
}

function navDist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z) + Math.abs((a.y ?? 0) - (b.y ?? 0)) * 2;
}

function nearestNav(nav, pos) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < nav.length; i++) {
    const d = navDist(nav[i], { x: pos.x, y: pos.y ?? 0, z: pos.z });
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// Dijkstra 最短路（导航图很小，线性取最小距离即可）。沿走廊走，不再贪心斜穿墙体。
function planPath(map, bot, goal) {
  if (!goal) return [];
  const nav = map.nav;
  if (!nav.length) return [];
  const start = nearestNav(nav, bot.pos);
  const goalIdx = nearestNav(nav, goal);
  if (start === goalIdx) return [nav[start]];
  const dist = new Array(nav.length).fill(Infinity);
  const prev = new Array(nav.length).fill(-1);
  const visited = new Array(nav.length).fill(false);
  dist[start] = 0;
  for (let it = 0; it < nav.length; it++) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < nav.length; i++) {
      if (!visited[i] && dist[i] < best) {
        best = dist[i];
        u = i;
      }
    }
    if (u === -1) break;
    visited[u] = true;
    if (u === goalIdx) break;
    for (const li of nav[u].links || []) {
      const w = navDist(nav[u], nav[li]);
      if (dist[u] + w < dist[li]) {
        dist[li] = dist[u] + w;
        prev[li] = u;
      }
    }
  }
  if (dist[goalIdx] === Infinity) return [];
  const path = [];
  let cur = goalIdx;
  while (cur !== start && cur !== -1) {
    path.unshift(nav[cur]);
    cur = prev[cur];
  }
  path.unshift(nav[start]);
  return path;
}

function moveAlongPath(room, bot, b) {
  const nav = room.map.nav;
  if (!nav.length) return;
  let waypoint = b.nextNode;
  if (!waypoint || distance(bot.pos, { x: waypoint.x, y: 0, z: waypoint.z }) < 1.1) {
    if (b.path.length) {
      waypoint = b.path.shift();
      b.nextNode = waypoint;
    } else {
      waypoint = b.goal || nav[0];
    }
  }
  if (!waypoint) return;
  const dx = waypoint.x - bot.pos.x;
  const dz = waypoint.z - bot.pos.z;
  const dy = (waypoint.y ?? 0) - bot.pos.y;
  const hDist = Math.hypot(dx, dz);
  // 明显更高的平台（如箱子顶部）且靠近时才跳跃；台阶交给自动上台阶系统，不再随机乱跳
  if (dy > 0.5 && hDist < 2.4 && dy < 2.2) bot.input.j = 1;
  const len = hDist || 1;
  const tx = dx / len;
  const tz = dz / len;
  // 以 bot 朝向为前向量，换算成按键
  const fx = -Math.sin(bot.yaw);
  const fz = -Math.cos(bot.yaw);
  const rx = -fz;
  const rz = fx;
  const forward = tx * fx + tz * fz;
  const strafe = tx * rx + tz * rz;
  if (forward > 0.15) inputSet(bot, 0, 1);
  else if (forward < -0.15) inputSet(bot, 1, 1);
  if (strafe > 0.2) inputSet(bot, 3, 1);
  else if (strafe < -0.2) inputSet(bot, 2, 1);
  bot.yaw = Math.atan2(-dx, -dz);
}

function inputSet(bot, idx, v) {
  bot.input.mv[idx] = v;
}

function engage(room, bot, enemy, distEnemy) {
  const b = bot.botBrain;
  const now = room.time;
  const w = bot.weapons.get(bot.activeSlot);
  const def = w?.def;

  if (bot.isZombie) {
    // 面向敌人直接追击
    const dx = enemy.pos.x - bot.pos.x;
    const dz = enemy.pos.z - bot.pos.z;
    bot.yaw = Math.atan2(-dx, -dz);
    bot.pitch = Math.atan2(enemy.pos.y + 1.2 - (bot.pos.y + 1.55), Math.hypot(dx, dz));
    if (distEnemy < 2.4) {
      bot.input.fire = 1;
      bot.input.mv = [1, 0, 0, 0];
    } else {
      moveToward(room, bot, enemy.pos);
    }
    return;
  }

  // 切枪：优先主武器，主武器换弹/空仓时切手枪补火，换弹完成后切回
  const primary = bot.weapons.get(2);
  const pistol = bot.weapons.get(1);
  let wantSlot = bot.activeSlot;
  if (primary) {
    const primReady = primary.state === 'ready' && primary.ammo > 0;
    const pistolReady = pistol && pistol.state === 'ready' && pistol.ammo > 0;
    if (wantSlot === 2 && !primReady && pistolReady) wantSlot = 1;
    else if (wantSlot === 1 && primReady) wantSlot = 2;
    else if (wantSlot === 1 && !pistolReady) wantSlot = 2;
  } else if (pistol && wantSlot !== 1) {
    wantSlot = 1;
  }
  if (wantSlot !== bot.activeSlot) bot.edge.sw = wantSlot;

  // 瞄准：带缓慢刷新的持续误差（远距离误差更大），并平滑转向 → 准但不锁头
  if (now >= b.aimRefreshAt) {
    b.aimRefreshAt = now + 0.22 + Math.random() * 0.3;
    const errScale = Math.min(0.12, 0.02 + distEnemy * 0.0016);
    b.aimErrX = (Math.random() - 0.5) * errScale;
    b.aimErrY = (Math.random() - 0.5) * errScale;
  }
  const dx = enemy.pos.x - bot.pos.x;
  const dy = enemy.pos.y + 1.3 - (bot.pos.y + 1.55);
  const dz = enemy.pos.z - bot.pos.z;
  bot.yaw = angLerp(bot.yaw, Math.atan2(-dx, -dz) + b.aimErrX, 0.55);
  bot.pitch = angLerp(bot.pitch, Math.atan2(dy, Math.hypot(dx, dz)) + b.aimErrY, 0.55);

  const aw = bot.weapons.get(bot.activeSlot);
  const adef = aw?.def;

  // 主动换弹：弹匣过低且当前没在连发时换弹；空仓时立即换弹
  if (aw && aw.ammo === 0) {
    bot.input.r = 1;
  } else if (aw && aw.state === 'ready' && aw.ammo <= (adef.magSize || 30) * 0.3 && now >= b.attackAt) {
    bot.input.r = 1;
    b.attackAt = now + 0.35;
  }

  // 开火：全自动按住连发（canFire 限速），半自动按射速点射（边沿触发）
  if (now >= b.attackAt && aw && aw.canFire(now)) {
    if (adef?.auto || adef?.melee) {
      bot.input.fire = 1;
      b.attackAt = now + 0.06;
    } else {
      bot.input.fire = 1;
      b.attackAt = now + Math.max(0.24, (60 / Math.max(1, adef.fireRate)) * 1.4 + 0.08);
    }
  }

  // 走位：保持中远距离施压 + 横向移动，太近后退
  if (now >= b.strafeAt) {
    b.strafeDir = Math.random() < 0.5 ? -1 : 1;
    b.strafeAt = now + 0.35 + Math.random() * 0.6;
  }
  bot.input.mv = [0, 0, 0, 0];
  if (distEnemy < 4) bot.input.mv[1] = 1;
  else if (distEnemy > 8) bot.input.mv[0] = 1;
  bot.input.mv[b.strafeDir > 0 ? 3 : 2] = 1;
}

function moveToward(room, bot, target) {
  const dy = (target.y ?? 0) - bot.pos.y;
  if (dy > 0.5 && Math.hypot(target.x - bot.pos.x, target.z - bot.pos.z) < 2.4 && dy < 2.2) {
    bot.input.j = 1;
  }
  const dx = target.x - bot.pos.x;
  const dz = target.z - bot.pos.z;
  const len = Math.hypot(dx, dz) || 1;
  const fx = -Math.sin(bot.yaw);
  const fz = -Math.cos(bot.yaw);
  const forward = (dx / len) * fx + (dz / len) * fz;
  bot.input.mv = [forward > 0 ? 1 : 0, forward <= 0 ? 1 : 0, 0, 0];
  bot.yaw = Math.atan2(-dx, -dz);
}

function handleObjective(room, bot) {
  const input = bot.input;
  if (room.mode === 'defusal') {
    // 拾取：T 机器人靠近实体炸弹按 E
    if (bot.team === TEAM.T && !bot.bombCarrier && room.bomb && !room.bomb.carried && !room.bomb.planted && room.bomb.pos) {
      const d = Math.hypot(bot.pos.x - room.bomb.pos.x, bot.pos.z - room.bomb.pos.z);
      if (d < 2.4) {
        input.u = 1;
        input.mv = [0, 0, 0, 0];
      }
    }
    if (bot.team === TEAM.T && bot.bombCarrier && room.core?.state === 'live' && !room.core.bombPlanted) {
      const site = room.map.sites.find((s) => {
        const d = Math.hypot(bot.pos.x - s.pos.x, bot.pos.z - s.pos.z);
        return d < s.radius;
      });
      if (site) {
        input.u = 1;
        input.mv = [0, 0, 0, 0];
      }
    }
    if (bot.team === TEAM.CT && room.core?.bombPlanted && room.bomb?.pos) {
      const d = Math.hypot(bot.pos.x - room.bomb.pos.x, bot.pos.z - room.bomb.pos.z);
      if (d < 2.4) {
        input.u = 1;
        input.mv = [0, 0, 0, 0];
      }
    }
  } else if (!bot.isZombie) {
    // 弹药不足 → 用弹药箱
    const w = bot.weapons.get(2) || bot.weapons.get(bot.activeSlot);
    if (w && w.ammo < w.def.magSize * 0.4) {
      const box = room.ammoBoxes.find((b) => b.available && Math.hypot(b.pos.x - bot.pos.x, b.pos.z - bot.pos.z) < 2);
      if (box) input.u = 1;
    }
    // 血量过低 → 用回血箱
    if (bot.hp < bot.maxHp * 0.6) {
      const hb = room.healthBoxes.find((b) => b.available && Math.hypot(b.pos.x - bot.pos.x, b.pos.z - bot.pos.z) < 2);
      if (hb) input.u = 1;
    }
  }
}
