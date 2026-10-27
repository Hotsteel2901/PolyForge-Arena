// Mutator 规则包：演示服务端 Mod 的新接口（setRule / command / tell / 事件订阅）。
// 低重力 + 伤害倍率都是"热规则"：改动会广播到所有客户端，客户端本地预测同步生效。

export default {
  id: 'mutator',
  name: 'Mutator 规则包',
  version: '1.1.0',

  async init(ctx) {
    ctx.log('rules before', JSON.stringify(ctx.rules));

    // 开局即生效的规则
    ctx.setRule('gravity', 0.55);
    ctx.setRule('damageMult', 1.15);
    ctx.say('规则包已启用：低重力 0.55× · 伤害 115%');

    // 聊天命令：!grav 0.8 / !ff on|off / !rule
    ctx.command('grav', (p, args) => {
      const v = Number(args[0]);
      if (!Number.isFinite(v) || v < 0.1 || v > 3) {
        ctx.tell(p.id, '用法：!grav 0.1 ~ 3');
        return;
      }
      ctx.setRule('gravity', v);
    });

    ctx.command('ff', (p, args) => {
      const on = args[0] !== 'off';
      ctx.setRule('friendlyFire', on);
      ctx.tell(p.id, `友伤已${on ? '开启' : '关闭'}`);
    });

    ctx.command('rule', (p) => {
      const r = ctx.rules;
      ctx.tell(p.id, `当前规则：${Object.entries(r).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
    });

    // 事件订阅示例：连杀播报
    const streak = new Map();
    ctx.on('player_death', ({ killer, victim }) => {
      if (!killer || killer === victim) return;
      const n = (streak.get(killer.id) || 0) + 1;
      streak.set(killer.id, n);
      if (n === 3 || n === 5) ctx.say(`${killer.name} 已连续击杀 ${n} 人！`);
    });
    ctx.on('round_start', () => streak.clear());
  },
};
