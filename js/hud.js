// HUD：血条、弹药、击杀播报、记分板、聊天、横幅、准星。

import { PRICES } from '../shared/economy.js';
import { weaponDef, weaponName } from './weapon-registry.js';

const $ = (id) => document.getElementById(id);
const WEAPON_SHORT = {
  fang: '刀', k9: '手枪', vx9: '冲', arc17: '步', warden: '霰',
  longshot: '狙', bruiser: '机', thunder: '雷', zclaw: '爪',
};

export class Hud {
  init() {
    this.r = {
      crosshair: $('crosshair'),
      hitmarker: $('hitmarker'),
      hpBar: $('hp-bar').firstElementChild,
      hpLabel: $('hp-label'),
      armorBar: $('armor-bar').firstElementChild,
      armorLabel: $('armor-label'),
      ammoCur: $('ammo-cur'),
      ammoRes: $('ammo-res'),
      weaponName: $('weapon-name'),
      grenadeCount: $('grenade-count'),
      timer: $('timer'),
      scoreCt: $('score-ct'),
      scoreT: $('score-t'),
      teamLabel: $('team-label'),
      roundLabel: $('round-label'),
      modeLabel: $('mode-label'),
      money: $('money'),
      ping: $('ping'),
      objective: $('objective'),
      useProgress: $('use-progress'),
      useProgressLabel: $('use-progress-label'),
      useProgressBar: $('use-progress-bar').firstElementChild,
      killfeed: $('killfeed'),
      banner: $('banner'),
      bannerTitle: $('banner-title'),
      bannerSub: $('banner-sub'),
      vignette: $('vignette'),
      lowhp: $('lowhp'),
      scoreboard: $('scoreboard'),
      scoreTable: $('score-table').querySelector('tbody'),
      chatLog: $('chat-log'),
      chatInput: $('chat-input'),
      deadMsg: $('dead-msg'),
      statusDot: $('status-dot'),
      paused: $('paused'),
      slots: $('slots'),
      hint: $('hint'),
      modsHud: $('mods-hud'),
    };
    const slotNames = ['刀', '手枪', '主武器', '雷'];
    this.slotEls = [];
    for (let i = 0; i < 4; i++) {
      const el = document.createElement('div');
      el.className = 'slot';
      el.textContent = slotNames[i];
      this.r.slots.appendChild(el);
      this.slotEls.push(el);
    }
    this.bannerTimer = null;
    this.hitTimer = null;
    this.chatCb = null;
    this.mode = 'defusal';
    this.team = 1;
    this.bombCarrier = false;
    this.bomb = null;
    this.chatOpen = false;
    this.buyEl = document.createElement('div');
    this.buyEl.id = 'buy-menu';
    this.buyEl.className = 'hidden';
    this.buyEl.innerHTML = `
      <div class="buy-panel">
        <button id="buy-close" class="buy-close" title="关闭">×</button>
        <h2 id="buy-title">购买装备</h2>
        <div class="buy-money">💰 <span id="buy-money">0</span></div>
        <div id="buy-countdown"></div>
        <div id="buy-grid"></div>
        <div class="buy-hint">点击购买 · 点击空白处或 × 关闭</div>
      </div>
    `;
    document.getElementById('app').appendChild(this.buyEl);
    this.buyEl.addEventListener('click', (e) => {
      if (e.target === this.buyEl && this.buyCloseCb) this.buyCloseCb();
    });
    const closeBtn = document.getElementById('buy-close');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.buyCloseCb) this.buyCloseCb();
    });
    this.buyCb = null;
  }

  setStatus(ok) {
    this.r.statusDot.classList.toggle('ok', ok);
  }

  setMode(mode, label) {
    this.mode = mode;
    this.r.modeLabel.textContent = label;
    this.r.money.classList.toggle('hidden', mode !== 'defusal');
    this.r.scoreCt.textContent = mode === 'defusal' ? 'CT 0' : '人类 0';
    this.r.scoreT.textContent = mode === 'defusal' ? 'T 0' : '僵尸 0';
  }

  setSelf(entry, round, alive) {
    const hpPct = Math.max(0, Math.min(100, entry.h));
    this.r.hpBar.style.width = `${hpPct}%`;
    this.r.hpLabel.textContent = entry.h;
    const armorPct = Math.max(0, Math.min(100, entry.a));
    this.r.armorBar.style.width = `${armorPct}%`;
    this.r.armorLabel.textContent = entry.a;
    const def = weaponDef(entry.w) || {};
    this.r.weaponName.textContent = def.name || entry.w;
    const inf = def.melee || entry.am >= 999;
    this.r.ammoCur.textContent = inf ? '∞' : entry.am;
    this.r.ammoRes.textContent = inf ? '' : entry.rs;
    this.r.grenadeCount.textContent = `雷 ×${entry.g ?? 0}`;
    this.r.money.textContent = `💰 ${entry.mo ?? 0}`;
    this.team = entry.t;
    this.bombCarrier = !!entry.bc;
    if (this.mode === 'defusal') {
      this.r.teamLabel.textContent = entry.t === 1 ? 'CT（蓝）' : 'T（橙）';
      this.r.teamLabel.style.color = entry.t === 1 ? '#7fd0ff' : '#ffab5e';
    } else {
      this.r.teamLabel.textContent = entry.z ? '僵尸' : '人类';
      this.r.teamLabel.style.color = entry.z ? '#ff9b8a' : '#7fd0ff';
    }
    this.r.lowhp.style.opacity = alive && entry.h < 32 ? '1' : '0';
    this.r.deadMsg.classList.toggle('hidden', alive || (round && round.ph === 'buy'));
    this.setSlots(entry.w, entry.zb);
    this.updateObjective(round);
  }

  setSlots(activeId, zombie) {
    let activeSlot = -1;
    const ids = ['fang', 'k9', 'arc17', 'thunder'];
    if (zombie) {
      activeSlot = 0;
      this.slotEls[0].textContent = '爪';
    } else {
      this.slotEls.forEach((el, i) => {
        const id = ids[i];
        el.textContent = WEAPON_SHORT[id] || id;
      });
      const d = weaponDef(activeId);
      activeSlot = d ? d.slot : ids.indexOf(activeId);
    }
    this.slotEls.forEach((el, i) => el.classList.toggle('on', i === activeSlot));
  }

  setRound(round) {
    if (!round) return;
    this.r.roundLabel.textContent = `第 ${round.rn} 回合`;
    const scores = round.sc || {};
    if (this.mode === 'defusal') {
      this.r.scoreCt.textContent = `CT ${scores.CT ?? 0}`;
      this.r.scoreT.textContent = `T ${scores.T ?? 0}`;
    } else {
      this.r.scoreCt.textContent = `人类 ${scores.HUMAN ?? 0}`;
      this.r.scoreT.textContent = `僵尸 ${scores.ZOMBIE ?? 0}`;
    }
    if (round.ph === 'buy') {
      this.r.timer.textContent = `购买 ${round.bu}s`;
    } else if (round.st === 'ended') {
      this.r.timer.textContent = '—:—';
    } else {
      const secs = Math.max(0, round.tl || 0);
      const m = Math.floor(secs / 60);
      const s = String(Math.floor(secs % 60)).padStart(2, '0');
      this.r.timer.textContent = `${m}:${s}`;
    }
  }

  setBomb(b) {
    this.bomb = b || null;
  }

  updateObjective(round) {
    const z = this.r;
    if (this.mode === 'defusal') {
      if (!round || round.st === 'ended') {
        z.objective.textContent = '';
      } else if (round.ph === 'buy') {
        z.objective.textContent = `购买阶段：按 B 打开购买菜单（剩余 ${round.bu}s）`;
      } else if (round.bl > 0) {
        z.objective.textContent = `炸弹已安放！${Math.ceil(round.bl)} 秒后爆炸`;
      } else if (this.bombCarrier) {
        z.objective.textContent = '携带炸弹：前往 A / B 点按住 E 安放';
      } else if (this.team === 1) {
        z.objective.textContent = '防守安放点，阻止敌人安放炸弹';
      } else if (this.bomb && this.bomb.carried) {
        z.objective.textContent = '炸弹已被队友携带，掩护安放';
      } else if (this.bomb && this.bomb.pos) {
        z.objective.textContent = '炸弹未激活：走近按 E 拾取';
      } else {
        z.objective.textContent = '夺取炸弹并前往安放点（E）';
      }
    } else if (this.mode === 'zombie') {
      if (!round || round.st === 'ended') {
        z.objective.textContent = '';
      } else if (this.team === 2) {
        z.objective.textContent = '感染所有人类！';
      } else {
        z.objective.textContent = '在时限内存活！弹药箱 / 回血箱可补给（E）';
      }
    }
  }

  addKillFeed(data) {
    const div = document.createElement('div');
    div.className = 'kf';
    if (data.type === 'kill') {
      const killer = document.createElement('b');
      killer.className = data.killer === this.selfId ? 'sys' : 'killer';
      killer.textContent = data.killerName || (data.killer ? `#${data.killer.slice(0, 4)}` : '环境');
      const vic = document.createElement('b');
      vic.className = data.victim === this.selfId ? 'sys' : 'victim';
      vic.textContent = data.victimName || `#${data.victim.slice(0, 4)}`;
      const w = document.createElement('span');
      w.textContent = data.weapon === 'zclaw' ? ' [尸爪]' : data.weapon ? ` [${WEAPON_SHORT[data.weapon] || data.weapon}]` : '';
      div.append(killer, document.createTextNode(' → '), vic, w);
      if (data.zombie) div.append(document.createTextNode(' ☣'));
    } else if (data.type === 'sys') {
      const b = document.createElement('b');
      b.className = 'sys';
      b.textContent = data.text;
      div.appendChild(b);
    }
    this.r.killfeed.prepend(div);
    while (this.r.killfeed.children.length > 6) this.r.killfeed.lastElementChild.remove();
    setTimeout(() => div.remove(), 5200);
  }

  banner(title, sub, win = null) {
    this.r.bannerTitle.textContent = title;
    this.r.bannerSub.textContent = sub || '';
    this.r.bannerTitle.style.color = win === true ? '#9fe6b6' : win === false ? '#ff9b8a' : '#ffffff';
    this.r.banner.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => this.r.banner.classList.remove('show'), 1600);
  }

  hitmarker(headshot = false) {
    this.r.hitmarker.classList.toggle('hs', headshot);
    this.r.hitmarker.classList.remove('hidden');
    clearTimeout(this.hitTimer);
    this.hitTimer = setTimeout(() => this.r.hitmarker.classList.add('hidden'), 140);
  }

  damageFlash() {
    this.r.vignette.style.opacity = '0.8';
    setTimeout(() => { this.r.vignette.style.opacity = '0'; }, 260);
  }

  addChat(name, text, system = false) {
    const div = document.createElement('div');
    div.className = 'chat-line' + (system ? ' system' : '');
    const span = document.createElement('span');
    span.className = 'name';
    span.textContent = system ? '系统' : name;
    div.append(span, document.createTextNode(`: ${text}`));
    this.r.chatLog.appendChild(div);
    while (this.r.chatLog.children.length > 40) this.r.chatLog.firstElementChild.remove();
  }

  openChat(cb, onClose) {
    if (this.chatOpen) return;
    this.chatOpen = true;
    this.chatCb = cb;
    this.chatOnClose = onClose;
    this.r.chatInput.classList.remove('hidden');
    this.r.chatInput.focus();
    // 移动端把输入框移到屏幕顶部，避免被弹出的虚拟键盘遮挡
    const wrap = this.r.chatInput.closest('#chat-wrap');
    if (wrap) {
      const touch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
      wrap.classList.toggle('mobile-open', touch);
    }
  }

  closeChat() {
    if (!this.chatOpen) return;
    this.chatOpen = false;
    this.r.chatInput.classList.add('hidden');
    this.r.chatInput.value = '';
    const wrap = this.r.chatInput.closest('#chat-wrap');
    if (wrap) wrap.classList.remove('mobile-open');
    if (this.chatOnClose) this.chatOnClose();
    this.chatOnClose = null;
  }

  bindChat() {
    this.r.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const text = this.r.chatInput.value.trim();
        this.closeChat();
        if (text && this.chatCb) this.chatCb(text);
      } else if (e.key === 'Escape') {
        this.closeChat();
      }
      e.stopPropagation();
    });
  }

  showScoreboard(show, players, selfId) {
    this.r.scoreboard.classList.toggle('hidden', !show);
    if (!show) return;
    const rows = [...players].sort((a, b) => b.sc - a.sc || b.k - a.k);
    this.r.scoreTable.innerHTML = '';
    for (const p of rows) {
      const tr = document.createElement('tr');
      const team = p.zb ? 2 : p.t;
      const name = document.createElement('td');
      name.textContent = p.n + (p.i === selfId ? '（你）' : '');
      name.className = `team-${team}`;
      const t = document.createElement('td');
      t.textContent = p.zb ? '僵尸' : p.t === 1 ? 'CT/人类' : 'T';
      const k = document.createElement('td');
      k.textContent = p.k;
      const d = document.createElement('td');
      d.textContent = p.d;
      const s = document.createElement('td');
      s.textContent = p.sc;
      const st = document.createElement('td');
      st.textContent = p.al ? (p.zb ? '☣ 已感染' : '存活') : '阵亡';
      tr.append(name, t, k, d, s, st);
      this.r.scoreTable.appendChild(tr);
    }
  }

  setPaused(paused) {
    this.r.paused.classList.toggle('hidden', !paused);
  }

  showUseProgress(action, pct) {
    this.r.useProgressLabel.textContent = action === 'defuse' ? '拆除炸弹…' : '安放炸弹…';
    this.r.useProgressBar.style.width = Math.round(pct * 100) + '%';
    this.r.useProgress.classList.remove('hidden');
  }

  hideUseProgress() {
    this.r.useProgress.classList.add('hidden');
  }

  setPing(ms) {
    this.r.ping.textContent = Number.isFinite(ms) ? `${ms}ms` : '--';
  }

  showBuyMenu({ money, phase, remaining, boughtItems = [] }, cb, refundCb, closeCb) {
    this.buyCb = cb;
    this.refundCb = refundCb;
    this.buyCloseCb = closeCb;
    const grid = document.getElementById('buy-grid');
    grid.innerHTML = '';
    // 主循环每 250ms 重绘，先清掉上次追加的提示行，避免无限堆积
    grid.parentElement.querySelectorAll('.buy-refunds').forEach((el) => el.remove());
    const names = { armor: '护甲（100）', grenade: '手雷' };
    for (const [id, price] of Object.entries(PRICES)) {
      const def = weaponDef(id) || {};
      const canBuy = phase === 'buy' && money >= price;
      const card = document.createElement('button');
      card.className = 'buy-card' + (canBuy ? '' : ' disabled');
      card.innerHTML = `<b>${names[id] || def.name || id}</b><span>$${price}</span>`;
      card.onclick = () => {
        if (canBuy && this.buyCb) this.buyCb(id);
      };
      grid.appendChild(card);
    }
    const refundRow = document.createElement('div');
    refundRow.className = 'buy-refunds';
    if (boughtItems.length) {
      for (const item of boughtItems) {
        const chip = document.createElement('button');
        chip.className = 'refund-chip';
        chip.innerHTML = `退还 ${names[item] || weaponName(item)} (+$${PRICES[item] ?? 0})`;
        chip.onclick = () => {
          if (this.refundCb) this.refundCb(item);
        };
        refundRow.appendChild(chip);
      }
    } else {
      refundRow.className += ' empty';
      refundRow.textContent = '本阶段暂无已购装备';
    }
    grid.after(refundRow);
    document.getElementById('buy-money').textContent = money;
    const countdown = document.getElementById('buy-countdown');
    countdown.textContent = phase === 'buy' ? `购买时间剩余 ${remaining}s` : '当前不在购买阶段';
    this.buyEl.classList.remove('hidden');
  }

  hideBuyMenu() {
    this.buyEl.classList.add('hidden');
    this.buyCb = null;
  }

  // 生化模式选枪界面：列出所有主武器（含 Mod 武器），点击立即装备
  showZombieMenu({ money, items = [], equippedId }, cb, closeCb) {
    this.buyCb = cb;
    this.buyCloseCb = closeCb;
    document.getElementById('buy-title').textContent = '选枪（生化）';
    const grid = document.getElementById('buy-grid');
    grid.innerHTML = '';
    // 主循环每 250ms 重绘，先清掉上次追加的提示行，避免无限堆积
    grid.parentElement.querySelectorAll('.buy-refunds').forEach((el) => el.remove());
    for (const it of items) {
      const isEquipped = it.id === equippedId;
      const canBuy = money >= it.cost && !isEquipped;
      const card = document.createElement('button');
      card.className = 'buy-card' + (canBuy ? '' : ' disabled');
      card.innerHTML = `<b>${it.name || it.id}${isEquipped ? '（当前）' : ''}</b><span>$${it.cost}</span>`;
      card.onclick = () => {
        if (canBuy && this.buyCb) this.buyCb(it.id);
      };
      grid.appendChild(card);
    }
    const refundRow = document.createElement('div');
    refundRow.className = 'buy-refunds empty';
    refundRow.textContent = '选择后立即装备（重生后保持） · 每击杀一只丧尸 +$200';
    grid.after(refundRow);
    document.getElementById('buy-money').textContent = money;
    const countdown = document.getElementById('buy-countdown');
    countdown.textContent = '随时可按 B 打开选枪';
    this.buyEl.classList.remove('hidden');
  }

  setCrosshair(html) {
    this.r.crosshair.innerHTML = html;
    this.r.hitmarker = this.r.crosshair.querySelector('#hitmarker');
  }

  appendMod(el) {
    this.r.modsHud.appendChild(el);
  }

  toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
  }
}
