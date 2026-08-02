// 简单 Bot：导航点寻路 + 索敌交火 + 目标行为（安放/拆除/追击/逃窜）。

import { TEAM } from '../shared/constants.js';
import { distance, directionFromAngles } from '../shared/math.js';
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
        bot.yaw += (Math.random() - 0.5) * 1.6;
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
    // 目标粘滞：拆弹模式选定点位后一路走到；CT 在炸弹安放后改去拆弹；T 在有实体炸弹时先去拾取
    if (room.mode === 'defusal') {
      const bombPlanted = room.core?.bombPlanted && room.bomb?.pos;
      const needPickup = bot.team === TEAM.T && !bot.bombCarrier && room.bomb && !room.bomb.planted && room.bomb.pos;
      if (bot.team === TEAM.CT && bombPlanted) {
        b.goal = { x: room.bomb.pos.x, z: room.bomb.pos.z, y: room.bomb.pos.y ?? 0 };
        b.bombGoal = true;
      } else if (needPickup) {
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
  const fwd = directionFromAngles(from.yaw, from.pitch);
  const max = distance(from.pos, to.pos);
  const t = traceWorld(room.map, { x: from.pos.x, y: from.pos.y + 1.55, z: from.pos.z }, fwd, max);
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

function planPath(map, bot, goal) {
  if (!goal) return [];
  const nav = map.nav;
  if (!nav.length) return [];
  let start = 0;
  let startD = Infinity;
  for (let i = 0; i < nav.length; i++) {
    const d = navDist(nav[i], { x: bot.pos.x, y: bot.pos.y, z: bot.pos.z });
    if (d < startD) {
      startD = d;
      start = i;
    }
  }
  let goalIdx = start;
  let goalD = Infinity;
  for (let i = 0; i < nav.length; i++) {
    const d = navDist(nav[i], goal);
    if (d < goalD) {
      goalD = d;
      goalIdx = i;
    }
  }
  if (start === goalIdx) return [nav[start]];
  // 贪心：每次选择离目标最近的未访问邻居（带随机扰动避免死循环）。
  // 路径包含起点节点：先退回到最近的导航点，再沿图前进（避免从任意位置斜穿墙体）。
  const path = [nav[start]];
  const visited = new Set([start]);
  let cur = start;
  for (let step = 0; step < 24; step++) {
    const node = nav[cur];
    let next = -1;
    let best = Infinity;
    const options = (node.links || []).slice();
    // 加入随机扰动
    for (const li of options) {
      if (visited.has(li)) continue;
      const d = navDist(nav[li], goal) + Math.random() * 3;
      if (d < best) {
        best = d;
        next = li;
      }
    }
    if (next === -1) break;
    visited.add(next);
    path.push(nav[next]);
    cur = next;
    if (cur === goalIdx) break;
  }
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
  // 需要上台阶时跳跃
  const dy = (waypoint.y ?? 0) - bot.pos.y;
  if (dy > 0.55 && Math.hypot(waypoint.x - bot.pos.x, waypoint.z - bot.pos.z) < 2.6) {
    bot.input.j = 1;
  }
  const dx = waypoint.x - bot.pos.x;
  const dz = waypoint.z - bot.pos.z;
  const len = Math.hypot(dx, dz) || 1;
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
  if (Math.random() < 0.02) bot.input.j = 1;
}

function inputSet(bot, idx, v) {
  bot.input.mv[idx] = v;
}

function engage(room, bot, enemy, distEnemy) {
  const b = bot.botBrain;
  const now = room.time;
  const w = bot.weapons.get(bot.activeSlot);
  const def = w?.def;

  // 面向敌人（带误差）
  const err = 0.02 + Math.random() * 0.1;
  const dx = enemy.pos.x - bot.pos.x;
  const dy = enemy.pos.y + 1.3 - (bot.pos.y + 1.55);
  const dz = enemy.pos.z - bot.pos.z;
  bot.yaw = Math.atan2(-dx, -dz) + (Math.random() - 0.5) * err * 6;
  bot.pitch = Math.atan2(dy, Math.hypot(dx, dz)) + (Math.random() - 0.5) * err * 4;

  if (bot.isZombie) {
    if (distEnemy < 2.4) {
      bot.input.fire = 1;
      bot.input.mv = [1, 0, 0, 0];
    } else {
      moveToward(room, bot, enemy.pos);
    }
    return;
  }

  // 人类：点射/连射 + 换弹 + 后退保持距离
  if (now >= b.attackAt && w && w.canFire(now)) {
    const isAuto = def?.auto || def?.melee;
    if (isAuto && (now < b.burstUntil || Math.random() < 0.55)) {
      bot.input.fire = 1;
      if (Math.random() < 0.25) b.burstUntil = now + 0.5 + Math.random() * 0.4;
      b.attackAt = now + 0.12;
    } else {
      // 半自动：单发点射，松开发射键后再扣下一发
      bot.input.fire = isAuto ? 0 : 1;
      b.attackAt = now + (isAuto ? 0.6 + Math.random() * 0.9 : Math.max(0.22, (60 / def.fireRate) * 1.15));
    }
  }
  if (w && w.ammo === 0 && now >= b.attackAt) {
    bot.input.r = 1;
  }
  if (distEnemy > 12 && def?.id === 'warden') {
    bot.edge.sw = 1;
  }
  // 走位
  if (now >= b.strafeAt) {
    b.strafeDir = Math.random() < 0.5 ? -1 : 1;
    b.strafeAt = now + 0.4 + Math.random() * 0.7;
  }
  bot.input.mv = [1, 0, 0, 0];
  bot.input.mv[b.strafeDir > 0 ? 3 : 2] = 1;
  if (distEnemy < 5) bot.input.mv[1] = 1; // 后退
}

function moveToward(room, bot, target) {
  const dy = (target.y ?? 0) - bot.pos.y;
  if (dy > 0.55 && Math.hypot(target.x - bot.pos.x, target.z - bot.pos.z) < 2.6) {
    bot.input.j = 1;
  }
  const dx = target.x - bot.pos.x;
  const dz = target.z - bot.pos.z;
  const len = Math.hypot(dx, dz) || 1;
  const fx = -Math.sin(bot.yaw);
  const fz = -Math.cos(bot.yaw);
  const forward = (dx / len) * fx + (dz / len) * fz;
  bot.input.mv = [forward > 0 ? 1 : 0, forward <= 0 ? 1 : 0, 0, 0];
  if (Math.random() < 0.05) bot.input.j = 1;
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
  } else if (!bot.isZombie && room.map.ammoBoxes) {
    const w = bot.weapons.get(2);
    if (w && w.ammo < w.def.magSize * 0.4) {
      const box = room.ammoBoxes.find((b) => b.available && Math.hypot(b.pos.x - bot.pos.x, b.pos.z - bot.pos.z) < 2);
      if (box) input.u = 1;
    }
  }
}
