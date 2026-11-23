// 服务端 Mod：PX-12 等离子霰弹枪（6发聚能等离子扩散弹，近距离爆发惊人）

export default {
  id: 'plasma-shotgun',
  name: 'PX-12 等离子霰弹枪',
  version: '1.0.0',
  init(ctx) {
    ctx.registerWeapon({
      id: 'plasma_shotgun',
      name: 'PX-12 等离子霰弹',
      role: '等离子扩散 · 近战毁灭',
      slot: 2,
      price: 2800,
      auto: false,
      fireRate: 105,
      damage: 22,
      headshotMult: 1.65,
      armorPen: 0.78,
      pellets: 6,
      magSize: 8,
      reserve: 40,
      reloadTime: 2.35,
      spread: 0.068,
      adsSpread: 0.032,
      recoil: 0.055,
      moveMult: 0.90,
      falloffNear: 12,
      falloffFar: 36,
      falloffMin: 0.38,
      sound: 'plasma',
    });
    ctx.log('PX-12 等离子霰弹枪已注册');
  },
};
