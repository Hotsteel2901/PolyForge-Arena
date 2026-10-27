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
      skill: $('skill'),
      ggLadder: $('gg-ladder'),
      dmgNumbers: $('dmg-numbers'),
      dmgDirs: $('dmg-dirs'),
      killConfirm: $('kill-confirm'),
      fps: $('fps'),
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
    this.primaryId = null;
    this.deathInfo = null;
    this.ladder = null;
    this.selfLevel = 0;
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

  setMode(mode, label, opts = {}) {
    this.mode = mode;
    this.scoreLimit = opts.scoreLimit || 0;
    this.r.modeLabel.textContent = label;
    // 拆弹/生化有经济；死斗与军备竞赛没有商店，金钱栏隐藏
    const moneyMode = mode === 'defusal' || mode === 'zombie';
    this.r.money.classList.toggle('hidden', !moneyMode);
    if (mode === 'defusal') {
      this.r.scoreCt.textContent = 'CT 0';
      this.r.scoreT.textContent = 'T 0';
    } else if (mode === 'zombie') {
      this.r.scoreCt.textContent = '人类 0';
      this.r.scoreT.textContent = '僵尸 0';
    } else if (mode === 'tdm') {
      this.r.scoreCt.textContent = 'CT 0';
      this.r.scoreT.textContent = 'T 0';
    } else {
      // 军备竞赛是自由混战：比分栏换成等级提示
      this.r.scoreCt.textContent = '等级 —';
      this.r.scoreT.textContent = '目标 匕首';
    }
    // 军备竞赛只有一把武器，四格武器槽没有意义
    this.r.slots.classList.toggle('hidden', mode === 'gungame');
    this.r.grenadeCount.classList.toggle('hidden', mode === 'gungame');
  }

  // 一局结束/重进时清空临时 UI，避免上一局的击杀播报、伤害数字残留
  reset() {
    this._lastRespawnHtml = null;
    this.r.killfeed.innerHTML = '';
    this.r.dmgNumbers.innerHTML = '';
    this.r.dmgDirs.innerHTML = '';
    this.r.killConfirm.classList.remove('show');
    this.r.deadMsg.classList.add('hidden');
    this.r.deadMsg.textContent = '你已阵亡 · 等待下一回合';
    this.r.vignette.style.opacity = '0';
    this.r.lowhp.style.opacity = '0';
    this.r.banner.classList.remove('show');
    this.deathInfo = null;
  }

  setCrosshairColor(color) {
    if (!color) return;
    this.r.crosshair.style.setProperty('--ch-color', color);
  }

  // 复活倒计时：拆弹模式阵亡后本回合不再复活（-1），生化模式显示秒数
  setRespawn(sec, alive = false) {
    if (alive) {
      this.r.deadMsg.classList.add('hidden');
      return;
    }
    const info = this.deathInfo ? `${this.deathInfo}<br>` : '';
    const body = sec > 0 ? `复活倒计时 <b>${sec}</b>s` : '等待下一回合';
    const html = info + body;
    // 快照 20Hz：内容没变就不重写 innerHTML，避免每帧解析 DOM
    if (this._lastRespawnHtml !== html) {
      this._lastRespawnHtml = html;
      this.r.deadMsg.innerHTML = html;
    }
    this.r.deadMsg.classList.remove('hidden');
  }

  setDeathInfo(killerName, weapon, headshot = false) {
    this._lastRespawnHtml = null;
    const w = WEAPON_SHORT[weapon] || weaponName(weapon) || '未知武器';
    this.deathInfo = `被 <b>${killerName || '环境'}</b> 用 ${w} 击杀${headshot ? '（爆头）' : ''}`;
  }

  // 受击方向箭头：angle 为相对朝向的弧度（0=正前，正=右侧）
  damageDirection(angle) {
    const el = document.createElement('i');
    el.className = 'dmg-dir';
    el.style.transform = `translate(-50%, -50%) rotate(${angle}rad) translateY(-132px)`;
    this.r.dmgDirs.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  // 命中伤害数字：从准星附近弹出并上飘
  damageNumber(dmg, headshot = false) {
    const el = document.createElement('span');
    el.className = 'dmg-num' + (headshot ? ' hs' : '');
    el.textContent = dmg > 0 ? dmg : '';
    if (!el.textContent) return;
    const dx = (Math.random() - 0.5) * 54;
    el.style.setProperty('--dx', `${dx}px`);
    el.style.left = `calc(50% + ${dx}px)`;
    el.style.top = 'calc(50% + 26px)';
    this.r.dmgNumbers.appendChild(el);
    setTimeout(() => el.remove(), 750);
  }

  killConfirm(headshot = false, weapon = '') {
    const el = this.r.killConfirm;
    el.textContent = headshot ? '爆头击杀' : '击杀';
    el.classList.toggle('hs', !!headshot);
    el.classList.add('show');
    clearTimeout(this.killTimer);
    this.killTimer = setTimeout(() => el.classList.remove('show'), 800);
    this._buzz(20);
  }

  setFps(v, host = false) {
    this.r.fps.textContent = `${v} FPS${host ? ' · 房主' : ''}`;
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
    if (this.mode === 'defusal' || this.mode === 'tdm') {
      this.r.teamLabel.textContent = entry.t === 1 ? 'CT（蓝）' : 'T（橙）';
      this.r.teamLabel.style.color = entry.t === 1 ? '#7fd0ff' : '#ffab5e';
    } else if (this.mode === 'zombie') {
      this.r.teamLabel.textContent = entry.z ? '僵尸' : '人类';
      this.r.teamLabel.style.color = entry.z ? '#ff9b8a' : '#7fd0ff';
    } else {
      // 军备竞赛：没有阵营，显示"自由混战"
      this.r.teamLabel.textContent = '自由混战';
      this.r.teamLabel.style.color = '#cfd8e3';
    }
    this.r.lowhp.style.opacity = alive && entry.h < 32 ? '1' : '0';
    this.setSlots(entry.w, entry.zb);
    this.updateObjective(round);
    // 生化丧尸 F 加速技能指示
    if (this.mode === 'zombie' && entry.zb) {
      this.r.skill.classList.remove('hidden');
      const cd = entry.sk ?? 0;
      this.r.skill.textContent = cd > 0 ? `F 加速 · ${cd}s` : 'F 加速 · 就绪';
      this.r.skill.classList.toggle('ready', cd === 0);
    } else {
      this.r.skill.classList.add('hidden');
    }
  }

  // 军备竞赛武器阶梯：一排小格，当前等级高亮，已通过的打勾
  setLadder(ladder, level = 0) {
    this.ladder = ladder || null;
    this.selfLevel = level;
    const el = this.r.ggLadder;
    if (!el) return;
    if (!ladder || !ladder.length) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    el.classList.remove('hidden');
    if (el.children.length !== ladder.length) {
      el.innerHTML = '';
      for (const id of ladder) {
        const chip = document.createElement('span');
        chip.className = 'gg-chip';
        chip.textContent = WEAPON_SHORT[id] || weaponName(id);
        chip.title = weaponName(id);
        el.appendChild(chip);
      }
    }
    [...el.children].forEach((chip, i) => {
      chip.classList.toggle('on', i === level);
      chip.classList.toggle('done', i < level);
    });
  }

  setSlots(activeId, zombie) {
    let activeSlot = -1;
    const d = weaponDef(activeId);
    // 记录最近一次持有的主武器：切到手枪时 "主武器" 槽位仍应显示那把枪的名字
    if (d && d.slot === 2) this.primaryId = activeId;
    if (zombie) {
      activeSlot = 0;
      this.slotEls[0].textContent = '爪';
    } else {
      this.slotEls[0].textContent = WEAPON_SHORT.fang;
      this.slotEls[1].textContent = WEAPON_SHORT.k9;
      this.slotEls[2].textContent = WEAPON_SHORT[this.primaryId] || '主';
      this.slotEls[3].textContent = WEAPON_SHORT.thunder;
      activeSlot = d ? d.slot : -1;
    }
    this.slotEls.forEach((el, i) => {
      el.classList.toggle('on', i === activeSlot);
      el.classList.toggle('off', zombie && i !== 0);
    });
  }

  setRound(round) {
    if (!round) return;
    this.r.roundLabel.textContent = `第 ${round.rn} 回合`;
    const scores = round.sc || {};
    if (this.mode === 'defusal' || this.mode === 'tdm') {
      this.r.scoreCt.textContent = `CT ${scores.CT ?? 0}`;
      this.r.scoreT.textContent = `T ${scores.T ?? 0}`;
    } else if (this.mode === 'zombie') {
      this.r.scoreCt.textContent = `人类 ${scores.HUMAN ?? 0}`;
      this.r.scoreT.textContent = `僵尸 ${scores.ZOMBIE ?? 0}`;
    } else {
      const total = (this.ladder && this.ladder.length) || 7;
      this.r.scoreCt.textContent = `等级 ${this.selfLevel + 1}/${total}`;
      this.r.scoreT.textContent = '目标 匕首';
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
    } else if (this.mode === 'tdm') {
      if (!round || round.st === 'ended') {
        z.objective.textContent = '';
      } else {
        const sc = round.sc || {};
        const limit = this.scoreLimit || 60;
        z.objective.textContent = `团队死斗：先到 ${limit} 杀 · 当前 CT ${sc.CT || 0} : ${sc.T || 0} T`;
      }
    } else if (this.mode === 'gungame') {
      if (!round || round.st === 'ended') {
        z.objective.textContent = '';
      } else {
        const total = (this.ladder && this.ladder.length) || 7;
        const cur = this.ladder ? (this.ladder[this.selfLevel] || '') : '';
        z.objective.textContent = `军备竞赛：${weaponName(cur)} · 第 ${this.selfLevel + 1}/${total} 级 · 匕首击杀夺冠`;
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

  // 移动端震动反馈：命中/受击/击杀各给一个不同长度
  _buzz(ms) {
    if (!this.haptics) return;
    if (navigator.vibrate) navigator.vibrate(ms);
  }

  hitmarker(headshot = false) {
    this.r.hitmarker.classList.toggle('hs', headshot);
    this.r.hitmarker.classList.remove('hidden');
    clearTimeout(this.hitTimer);
    this.hitTimer = setTimeout(() => this.r.hitmarker.classList.add('hidden'), 140);
    this._buzz(headshot ? 14 : 8);
  }

  // 受击红闪：0.8 会整屏发红、连 UI 一起染，压低到 0.5 并加快回落
  damageFlash() {
    this.r.vignette.style.opacity = '0.5';
    clearTimeout(this.dmgFlashTimer);
    this.dmgFlashTimer = setTimeout(() => { this.r.vignette.style.opacity = '0'; }, 190);
    this._buzz(24);
  }

  addChat(name, text, system = false) {
    const div = document.createElement('div');
    div.className = 'chat-line' + (system ? ' system' : '');
    const span = document.createElement('span');
    span.className = 'name';
    span.textContent = system ? '系统' : name;
    div.append(span, document.createTextNode(`: ${text}`));
    const log = this.r.chatLog;
    // 已在底部时才跟随新消息自动滚动；用户上翻查看历史时不打扰
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.appendChild(div);
    while (log.children.length > 40) log.firstElementChild.remove();
    if (nearBottom) log.scrollTop = log.scrollHeight;
  }

  openChat(cb, onClose) {
    if (this.chatOpen) return;
    this.chatOpen = true;
    this.chatCb = cb;
    this.chatOnClose = onClose;
    this.r.chatInput.classList.remove('hidden');
    this.r.chatInput.focus();
    this.chatHistory = this.chatHistory || [];
    this.chatIndex = this.chatHistory.length;
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
        if (text) {
          this.chatHistory = this.chatHistory || [];
          this.chatHistory.push(text);
          if (this.chatHistory.length > 12) this.chatHistory.shift();
        }
        this.closeChat();
        if (text && this.chatCb) this.chatCb(text);
      } else if (e.key === 'Escape') {
        this.closeChat();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // 上下键回溯历史输入（聊天里最常见的习惯）
        const h = this.chatHistory || [];
        if (!h.length) return e.stopPropagation();
        e.preventDefault();
        if (this.chatIndex === undefined) this.chatIndex = h.length;
        this.chatIndex += e.key === 'ArrowUp' ? -1 : 1;
        this.chatIndex = Math.max(0, Math.min(h.length, this.chatIndex));
        this.r.chatInput.value = this.chatIndex >= h.length ? '' : h[this.chatIndex];
        const v = this.r.chatInput.value;
        this.r.chatInput.setSelectionRange(v.length, v.length);
      }
      e.stopPropagation();
    });
  }

  showScoreboard(show, players, selfId) {
    this.r.scoreboard.classList.toggle('hidden', !show);
    if (!show) return;
    const rows = [...players].sort((a, b) => b.sc - a.sc || b.k - a.k);
    const alive = rows.filter((p) => p.al).length;
    const title = this.r.scoreboard.querySelector('.sb-title');
    if (title) title.textContent = `记分板 · 存活 ${alive}/${rows.length}`;
    this.r.scoreTable.innerHTML = '';
    for (const p of rows) {
      const tr = document.createElement('tr');
      const team = p.zb ? 2 : p.t;
      const name = document.createElement('td');
      name.textContent = p.n + (p.i === selfId ? '（你）' : '');
      name.className = `team-${team}`;
      const t = document.createElement('td');
      t.textContent = this.mode === 'gungame' ? `Lv ${(p.lv ?? 0) + 1}` : p.zb ? '僵尸' : p.t === 1 ? 'CT/人类' : 'T';
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
    const labels = { defuse: '拆除炸弹…', plant: '安放炸弹…', supply: '补给中…' };
    this.r.useProgressLabel.textContent = labels[action] || '使用中…';
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

  // 生化模式商店：列出所有主武器（含 Mod 武器）+ 护甲 / 手雷，点击立即装备
  showZombieMenu({ money, items = [], equippedId, armor = 0 }, cb, closeCb) {
    this.buyCb = cb;
    this.buyCloseCb = closeCb;
    document.getElementById('buy-title').textContent = '选枪（生化）';
    const grid = document.getElementById('buy-grid');
    grid.innerHTML = '';
    // 主循环每 250ms 重绘，先清掉上次追加的提示行，避免无限堆积
    grid.parentElement.querySelectorAll('.buy-refunds').forEach((el) => el.remove());
    for (const it of items) {
      const isEquipped = it.kind === 'weapon' ? it.id === equippedId
        : it.kind === 'armor' ? armor >= 100
          : false;
      const canBuy = money >= it.cost && !isEquipped;
      const card = document.createElement('button');
      card.className = 'buy-card' + (canBuy ? '' : ' disabled');
      const tag = it.kind === 'armor' ? (armor >= 100 ? '（已满）' : `（${Math.round(armor)}）`)
        : it.kind === 'grenade' ? '' : (isEquipped ? '（当前）' : '');
      card.innerHTML = `<b>${it.name || it.id}${tag}</b><span>$${it.cost}</span>`;
      card.onclick = () => {
        if (canBuy && this.buyCb) this.buyCb(it.id);
      };
      grid.appendChild(card);
    }
    const refundRow = document.createElement('div');
    refundRow.className = 'buy-refunds empty';
    refundRow.textContent = '武器/护甲选择后立即生效 · 每击杀一只丧尸 +$200';
    grid.after(refundRow);
    document.getElementById('buy-money').textContent = money;
    const countdown = document.getElementById('buy-countdown');
    countdown.textContent = '随时可按 B 打开';
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
