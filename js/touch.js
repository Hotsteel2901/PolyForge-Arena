// 移动端触控：左摇杆移动 + 右区视角 + 按钮组（射击/跳/蹲/开镜/换弹/互动/切枪/手雷）。

export function setupTouch(input, onLook, opts = {}) {
  if (!('ontouchstart' in window) && navigator.maxTouchPoints === 0) return null;
  // 诊断计数器：便于在真机/模拟器上确认触控事件是否到达
  window.__touchDebug = {
    ready: false,
    fire: 0,
    jump: 0,
    ads: 0,
    use: 0,
    reload: 0,
    joy: 0,
    joyMoves: 0,
    joyDX: 0,
    joyDY: 0,
    look: 0,
    lookMoves: 0,
    lookDX: 0,
    lookDY: 0,
    switch: 0,
    grenade: 0,
    crouch: 0,
    shop: 0,
    score: 0,
    chat: 0,
  };
  const ui = document.createElement('div');
  ui.id = 'touch-ui';
  ui.innerHTML = `
    <div class="zone" id="look-zone"></div>
    <div class="zone" id="joy-base"><div id="joy-knob"></div></div>
    <div id="btn-cluster">
      <div class="zone touch-btn" id="fire-btn"><span class="btn-label">射击</span></div>
      <div class="zone touch-btn" id="use-btn"><span class="btn-label">互动</span></div>
      <div class="zone touch-btn" id="switch-btn"><span class="btn-label">切枪</span></div>
      <div class="zone touch-btn" id="grenade-btn"><span class="btn-label">雷</span></div>
      <div class="zone touch-btn" id="jump-btn"><span class="btn-label">跳</span></div>
      <div class="zone touch-btn" id="ads-btn"><span class="btn-label">镜</span></div>
      <div class="zone touch-btn" id="crouch-btn"><span class="btn-label">蹲</span></div>
      <div class="zone touch-btn" id="reload-btn"><span class="btn-label">换弹</span></div>
      <div class="zone touch-btn" id="shop-btn"><span class="btn-label">商店</span></div>
      <div class="zone touch-btn" id="score-btn"><span class="btn-label">计分</span></div>
      <div class="zone touch-btn" id="chat-btn"><span class="btn-label">聊天</span></div>
    </div>
  `;
  document.getElementById('app').appendChild(ui);

  const joyBase = document.getElementById('joy-base');
  const knob = document.getElementById('joy-knob');
  const lookZone = document.getElementById('look-zone');
  const $btn = (id) => document.getElementById(id);
  const fireBtn = $btn('fire-btn');
  const jumpBtn = $btn('jump-btn');
  const adsBtn = $btn('ads-btn');
  const useBtn = $btn('use-btn');
  const reloadBtn = $btn('reload-btn');
  const switchBtn = $btn('switch-btn');
  const grenadeBtn = $btn('grenade-btn');
  const crouchBtn = $btn('crouch-btn');
  const shopBtn = $btn('shop-btn');
  const scoreBtn = $btn('score-btn');
  const chatBtn = $btn('chat-btn');

  let joyId = null;
  let joyOrigin = { x: 0, y: 0 };
  let lookId = null;
  let lookLast = { x: 0, y: 0 };

  const setJoy = (dx, dy) => {
    window.__touchDebug.joyMoves++;
    window.__touchDebug.joyDX += dx;
    window.__touchDebug.joyDY += dy;
    const len = Math.hypot(dx, dy);
    const max = 54;
    const cl = Math.min(len, max);
    const nx = (dx / (len || 1)) * cl;
    const nz = (dy / (len || 1)) * cl;
    knob.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${nz}px))`;
    const dead = 8;
    if (len < dead) {
      input.mvTouch = [0, 0, 0, 0];
      return;
    }
    input.mvTouch = [nz < 0 ? 1 : 0, nz > 0 ? 1 : 0, nx < 0 ? 1 : 0, nx > 0 ? 1 : 0];
  };

  joyBase.addEventListener('touchstart', (e) => {
    e.preventDefault();
    window.__touchDebug.joy++;
    const t = e.changedTouches[0];
    joyId = t.identifier;
    const r = joyBase.getBoundingClientRect();
    joyOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    setJoy(t.clientX - joyOrigin.x, t.clientY - joyOrigin.y);
  });
  joyBase.addEventListener('touchmove', (e) => {
    const t = [...e.changedTouches].find((x) => x.identifier === joyId);
    if (!t) return;
    e.preventDefault();
    setJoy(t.clientX - joyOrigin.x, t.clientY - joyOrigin.y);
  }, { passive: false });
  const joyEnd = (e) => {
    if ([...e.changedTouches].some((x) => x.identifier === joyId)) {
      joyId = null;
      knob.style.transform = 'translate(-50%,-50%)';
      input.mvTouch = [0, 0, 0, 0];
    }
  };
  joyBase.addEventListener('touchend', joyEnd);
  joyBase.addEventListener('touchcancel', joyEnd);

  lookZone.addEventListener('touchstart', (e) => {
    window.__touchDebug.look++;
    const t = e.changedTouches[0];
    lookId = t.identifier;
    lookLast = { x: t.clientX, y: t.clientY };
  }, { passive: false });
  lookZone.addEventListener('touchmove', (e) => {
    const t = [...e.changedTouches].find((x) => x.identifier === lookId);
    if (!t) return;
    e.preventDefault();
    window.__touchDebug.lookMoves++;
    const dx = t.clientX - lookLast.x;
    const dy = t.clientY - lookLast.y;
    window.__touchDebug.lookDX += dx;
    window.__touchDebug.lookDY += dy;
    lookLast = { x: t.clientX, y: t.clientY };
    onLook(dx, dy);
  }, { passive: false });
  const lookEnd = (e) => {
    if ([...e.changedTouches].some((x) => x.identifier === lookId)) lookId = null;
  };
  lookZone.addEventListener('touchend', lookEnd);
  lookZone.addEventListener('touchcancel', lookEnd);

  const hold = (el, onStart, onEnd, key) => {
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.__touchDebug[key]++;
      el.classList.add('pressed');
      if (navigator.vibrate) navigator.vibrate(12);
      onStart();
    }, { passive: false });
    el.addEventListener('touchend', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('pressed');
      onEnd();
    }, { passive: false });
    el.addEventListener('touchcancel', () => el.classList.remove('pressed'));
  };
  const tap = (el, fn, key) => hold(el, fn, () => {}, key);

  hold(fireBtn, () => { input.fire = true; }, () => { input.fire = false; }, 'fire');
  hold(useBtn, () => { input.useHeld = true; }, () => { input.useHeld = false; }, 'use');
  tap(jumpBtn, () => { input.jumpQueued = true; }, 'jump');
  tap(adsBtn, () => { input.ads = !input.ads; }, 'ads');
  tap(crouchBtn, () => { input.crouchHeld = !input.crouchHeld; }, 'crouch');
  tap(reloadBtn, () => { input.reloadQueued = true; }, 'reload');
  tap(switchBtn, () => {
    input.swdQueued = 1;
    if (opts.onSwitchRequest) opts.onSwitchRequest(null, 1);
  }, 'switch');
  tap(grenadeBtn, () => {
    input.switchQueued = 3;
    if (opts.onSwitchRequest) opts.onSwitchRequest(3, 0);
  }, 'grenade');
  tap(shopBtn, () => { if (opts.onShop) opts.onShop(); }, 'shop');
  tap(scoreBtn, () => { input.scoreboard = !input.scoreboard; }, 'score');
  tap(chatBtn, () => { if (opts.onChat) opts.onChat(); }, 'chat');

  window.__touchDebug.ready = true;
  return ui;
}
