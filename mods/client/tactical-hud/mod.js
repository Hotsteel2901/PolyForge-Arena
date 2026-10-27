// Tactical HUD：演示客户端 Mod 的新接口（hud.append / on(任意协议消息) / onKey）。
// F8 显示或隐藏面板。

export default {
  id: 'tactical-hud',
  name: 'Tactical HUD',
  version: '1.1.0',

  async init(ctx) {
    const el = document.createElement('div');
    el.className = 'mod-panel';
    el.innerHTML = `
      <div class="mp-title">战术面板</div>
      <div class="mp-row"><span>击杀</span><b data-k>0</b></div>
      <div class="mp-row"><span>死亡</span><b data-d>0</b></div>
      <div class="mp-row"><span>累计伤害</span><b data-dmg>0</b></div>
      <div class="mp-row"><span>重力</span><b data-grav>-</b></div>
      <div class="mp-hint">F8 隐藏</div>`;
    ctx.hud.append(el);

    const kEl = el.querySelector('[data-k]');
    const dEl = el.querySelector('[data-d]');
    const dmgEl = el.querySelector('[data-dmg]');
    const gravEl = el.querySelector('[data-grav]');
    let kills = 0;
    let deaths = 0;
    let damage = 0;

    const paint = () => {
      kEl.textContent = kills;
      dEl.textContent = deaths;
      dmgEl.textContent = damage;
      gravEl.textContent = ctx.rules.gravity ?? 1;
    };

    // 任意协议消息都可以订阅（这里是 kill / hit / rules）
    ctx.on('kill', (msg) => {
      if (msg.killer === ctx.state.selfId) kills += 1;
      if (msg.victim === ctx.state.selfId) deaths += 1;
      paint();
    });
    ctx.on('hit', (msg) => {
      damage += msg.dmg || 0;
      paint();
    });
    ctx.on('rules', paint);
    ctx.on('round_start', () => {
      kills = 0;
      deaths = 0;
      damage = 0;
      paint();
    });

    ctx.onKey('F8', () => {
      el.classList.toggle('mod-hidden');
      ctx.hud.toast(el.classList.contains('mod-hidden') ? '战术面板已隐藏' : '战术面板已显示');
    });
    paint();
  },
};
