// 示例客户端 Mod：AE-7 能量步枪。
// 客户端不注册武器（真实定义由房主 weapon_catalog 下发），这里只做 HUD 演示：
// 用能量步枪击杀时在 HUD 显示一条提示。

export default {
  id: 'energy-rifle',
  name: 'AE-7 能量步枪',
  version: '1.0.0',

  init(ctx) {
    ctx.registerWeapon({ id: 'energy_rifle', name: 'AE-7 能量步枪', slot: 2 });

    ctx.on('kill', (data) => {
      if (data.weapon !== 'energy_rifle') return;
      const el = document.createElement('div');
      el.className = 'mod-hud energy';
      el.textContent = `⚡ ${data.killerName || '玩家'} 用 AE-7 终结了 ${data.victimName || '敌人'}！`;
      ctx.hud.append(el);
      setTimeout(() => el.remove(), 4000);
    });
  },
};
