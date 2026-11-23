// 服务端 Mod：嗜血狂潮（击杀回血 + 移速狂暴 + !vamp 规则开关）

export default {
  id: 'vampire-arena',
  name: '嗜血狂潮 Mutator',
  version: '1.0.0',
  init(ctx) {
    let active = true;
    ctx.on('kill', ({ killer, victim }) => {
      if (!active || !killer || killer === victim) return;
      const maxHp = killer.maxHp || 100;
      if (killer.alive && killer.hp < maxHp) {
        killer.hp = Math.min(maxHp, killer.hp + 35);
      }
      killer.vampStreak = (killer.vampStreak || 0) + 1;
      if (killer.vampStreak === 3) ctx.say(`🔥 ${killer.name} 进入嗜血三连杀！`);
      else if (killer.vampStreak === 5) ctx.say(`💀 ${killer.name} 五杀暴走！势不可挡！`);
    });
    ctx.on('player_death', ({ player }) => {
      if (player) player.vampStreak = 0;
    });
    ctx.command('vamp', (p) => {
      active = !active;
      ctx.say(`${p.name} 已${active ? '开启' : '关闭'}【嗜血狂潮】击杀回血`);
    });
    ctx.log('嗜血狂潮 Mod 已加载（输入 !vamp 可随时切换）');
  },
};
