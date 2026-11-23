// 客户端 Mod：连杀播报与连杀徽章 HUD（双杀/三杀/四杀/五杀/超神）

const STREAK_NAMES = {
  2: ['DOUBLE KILL', '双杀！'],
  3: ['TRIPLE KILL', '三杀！火力全开'],
  4: ['QUADRA KILL', '四杀！无人能挡'],
  5: ['RAMPAGE', '五杀暴走！'],
  7: ['GODLIKE', '主宰战场 · 超神！'],
};

export default {
  id: 'killstreak-announcer',
  name: '连杀播报 HUD',
  version: '1.0.0',
  init(ctx) {
    let streak = 0;
    const badge = document.createElement('div');
    badge.style.cssText = 'position:fixed;right:18px;top:92px;padding:6px 14px;border-radius:10px;background:rgba(12,18,28,.75);border:1px solid rgba(255,190,60,.4);color:#ffd86b;font-weight:800;font-size:13px;letter-spacing:1.5px;display:none;pointer-events:none;z-index:12;backdrop-filter:blur(6px)';
    ctx.hud.append(badge);

    const refresh = () => {
      if (streak >= 2) {
        badge.style.display = 'block';
        badge.textContent = `🔥 连杀 ×${streak}`;
      } else {
        badge.style.display = 'none';
      }
    };

    ctx.on('kill', (ev) => {
      const selfId = ctx.game?.selfId;
      if (!selfId) return;
      if (ev.killer === selfId && ev.victim !== selfId) {
        streak += 1;
        refresh();
        const tag = STREAK_NAMES[streak] || (streak > 7 ? ['UNSTOPPABLE', `史诗 ${streak} 连杀！`] : null);
        if (tag) ctx.hud.banner(tag[0], tag[1]);
      } else if (ev.victim === selfId) {
        streak = 0;
        refresh();
      }
    });
    ctx.on('round_start', () => {
      streak = 0;
      refresh();
    });
  },
};
