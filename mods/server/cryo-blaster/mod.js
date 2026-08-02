// 服务器 Mod：CR-7 冰霜冲击枪。注册主武器，命中僵尸附加 1 秒减速，击杀额外计分并广播。
// 武器出现在生化模式选枪目录（cost 决定价格）；不强制替换默认主武器。

export default {
  id: 'cryo-blaster',
  name: 'CR-7 冰霜冲击枪',
  version: '1.0.0',

  init(ctx) {
    const def = {
      id: 'cryo_gun',
      name: 'CR-7 冰霜冲击枪',
      slot: 2,
      auto: true,
      fireRate: 420,
      damage: 16,
      headshotMult: 1.5,
      pellets: 1,
      magSize: 36,
      reserve: 120,
      reloadTime: 2.2,
      spread: 0.02,
      adsSpread: 0.008,
      recoil: 0.006,
      moveMult: 1,
      falloffNear: 18,
      falloffFar: 90,
      falloffMin: 0.7,
      sound: 'smg',
      cost: 600,
      freeze: true,
    };
    ctx.registerWeapon(def);

    // 冰冻减速：命中僵尸把减速叠加到 1 秒（约 30 tick）
    ctx.on('player_damage', (data) => {
      if (data.attacker && data.victim && data.victim.isZombie && data.weapon === 'cryo_gun') {
        data.victim.slowTicks = Math.max(data.victim.slowTicks || 0, 30);
      }
    });

    // 击杀额外计分 + 全房播报
    ctx.on('player_death', (data) => {
      if (data.info?.weapon === 'cryo_gun' && data.killer && data.killer !== data.victim) {
        data.killer.score += 5;
        ctx.broadcast('cryo_alert', {
          text: `${data.killer.name} 用 CR-7 冻结了 ${data.victim.name}！`,
        });
      }
    });
  },
};
