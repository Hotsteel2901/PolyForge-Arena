// 示例服务器 Mod：注册武器 + 事件钩子 + 面向玩家的 RPC。
// AE-7 只会出现在生化模式选枪目录中（不自动替换任何人主武器，需玩家购买）。

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
      pierce: true, // 能量束贯穿直线上的多个目标
    };
    ctx.registerWeapon(def);

    // 击杀额外计分
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
