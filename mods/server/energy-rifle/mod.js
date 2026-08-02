// 示例服务器 Mod：注册武器 + 事件钩子 + 面向玩家的 RPC。
// 新武器自动出现在 /api/mods 列表，并替换人类主武器槽位。

import { WeaponRuntime } from '../../../shared/weapons.js';

export default {
  id: 'energy-rifle',
  name: 'AE-7 能量步枪',
  version: '1.0.0',

  init(ctx) {
    const def = {
      id: 'energy_rifle',
      name: 'AE-7 能量步枪',
      slot: 2,
      auto: true,
      fireRate: 240,
      damage: 38,
      headshotMult: 2.1,
      pellets: 1,
      magSize: 40,
      reserve: Infinity,
      reloadTime: 2.6,
      spread: 0.015,
      adsSpread: 0.004,
      recoil: 0.012,
      moveMult: 0.95,
      falloffNear: 22,
      falloffFar: 130,
      falloffMin: 0.8,
      sound: 'rifle',
      energy: true,
    };
    ctx.registerWeapon(def);

    // 替换人类主武器（含之后加入的玩家）。
    // 生化模式不做自动替换：主武器由玩家在“选枪”中购买决定，避免买枪被覆盖/浪费钱。
    ctx.on('player_spawn', (data) => {
      const p = data.player;
      if (p.isZombie) return;
      if (ctx.mode === 'zombie') return;
      if (!p.weapons.has('energy_rifle')) {
        p.weapons.set(2, new WeaponRuntime(def));
        p.activeSlot = 2;
      }
    });

    // 能量武器击杀额外计分
    ctx.on('player_death', (data) => {
      if (data.info?.weapon === 'energy_rifle' && data.killer && data.killer !== data.victim) {
        data.killer.score += 8;
        ctx.broadcast('energy_alert', {
          text: `${data.killer.name} 用 AE-7 终结了 ${data.victim.name}！`,
        });
      }
    });

    // 客户端可调用 RPC：查能量武器统计
    ctx.on('client_message', (msg) => {
      if (msg.type === 'energy_stats') {
        ctx.sendTo(msg.playerId, 'energy_stats', {
          damage: def.damage,
          fireRate: def.fireRate,
          magSize: def.magSize,
          infiniteReserve: true,
        });
      }
    });
  },
};
