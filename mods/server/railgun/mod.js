// 服务器 Mod：MG-9 磁轨步枪。半自动高伤害主武器，击杀额外计分并广播。
// 武器出现在生化模式选枪目录（cost 决定价格）；不强制替换默认主武器。

export default {
  id: 'railgun',
  name: 'MG-9 磁轨步枪',
  version: '1.0.0',

  init(ctx) {
    const def = {
      id: 'railgun',
      name: 'MG-9 磁轨步枪',
      slot: 2,
      auto: false,
      fireRate: 80,
      damage: 95,
      headshotMult: 2.5,
      pellets: 1,
      magSize: 4,
      reserve: 16,
      reloadTime: 3.4,
      spread: 0.006,
      adsSpread: 0.002,
      recoil: 0.03,
      moveMult: 0.82,
      falloffNear: 60,
      falloffFar: 240,
      falloffMin: 0.85,
      sound: 'sniper',
      cost: 1200,
      railgun: true,
    };
    ctx.registerWeapon(def);

    // 击杀额外计分 + 全房播报
    ctx.on('player_death', (data) => {
      if (data.info?.weapon === 'railgun' && data.killer && data.killer !== data.victim) {
        data.killer.score += 8;
        ctx.broadcast('railgun_alert', {
          text: `${data.killer.name} 用 MG-9 磁轨贯穿了 ${data.victim.name}！`,
        });
      }
    });
  },
};
