// 移动端触控：左摇杆移动（推满自动疾跑） + 右区视角 + 分频按钮布局。
//
// 布局原则（按拇指可及性分层）：
//   核心层（右下角，半径 <170px）：射击 / 跳 / 蹲 / 换弹 / 开镜 —— 高频动作
//   次核心层（沿拇指弧线，170–230px）：互动 / 切枪 —— 常按但非每帧
//   低频层（屏幕顶部操作条）：计分 / 聊天 / 商店 / 技能 —— 偶尔使用
// 把低频键移出触控簇后，簇内按钮从 12 个减到 8 个，最远可及距离从 300px 降到 ~228px。

// 摇杆几何
const JOY_MAX = 54;      // 摇杆最大位移（px）
const JOY_DEAD = 8;      // 死区（px）
const SPRINT_ON = 0.85;  // 推程超过此比例触发疾跑
const SPRINT_OFF = 0.7;  // 回落到此比例以下取消疾跑（回滞，避免边界抖动）
const TOUCH_PAD = 28;    // 滑动跟手容差（px），约半根手指宽

// 动态摇杆热区（屏幕左下角占比）。
// 旧实现是固定圆：手指必须落在 128px 圆内，盲操常按空，且落点偏离圆心
// 会立刻产生一个斜方向。改为热区内"落点即原点"后可任意位置起手。
const JOY_HOT_W = 0.42;
const JOY_HOT_H = 0.55;

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
    skill: 0,
    fullscreen: 0,
    sprint: 0,
  };
  const ui = document.createElement('div');
  ui.id = 'touch-ui';
  ui.innerHTML = `
    <div class="zone" id="look-zone"></div>
    <div class="zone" id="joy-zone">
      <div id="joy-base"><div id="joy-knob"></div></div>
    </div>
    <div id="btn-cluster">
      <div class="zone touch-btn" id="fire-btn"><span class="btn-label">射击</span></div>
      <div class="zone touch-btn" id="use-btn"><span class="btn-label">互动</span></div>
      <div class="zone touch-btn" id="switch-btn"><span class="btn-label">切枪</span></div>
      <div class="zone touch-btn" id="jump-btn"><span class="btn-label">跳</span></div>
      <div class="zone touch-btn" id="ads-btn"><span class="btn-label">镜</span></div>
      <div class="zone touch-btn" id="crouch-btn"><span class="btn-label">蹲</span></div>
      <div class="zone touch-btn" id="reload-btn"><span class="btn-label">换弹</span></div>
    </div>
    <div id="touch-topbar">
      <div class="zone touch-btn top-btn" id="fullscreen-btn"><span class="btn-label">⛶</span></div>
      <div class="zone touch-btn top-btn" id="score-btn"><span class="btn-label">计分</span></div>
      <div class="zone touch-btn top-btn" id="chat-btn"><span class="btn-label">聊天</span></div>
      <div class="zone touch-btn top-btn" id="shop-btn"><span class="btn-label">商店</span></div>
      <div class="zone touch-btn top-btn hidden" id="skill-btn"><span class="btn-label">技能</span></div>
    </div>
    <div id="rotate-hint" class="hidden">建议横屏游玩以获得更宽视野 <b id="rotate-hint-close">×</b></div>
  `;
  document.getElementById('app').appendChild(ui);

  const joyZone = document.getElementById('joy-zone');
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
  const crouchBtn = $btn('crouch-btn');
  const shopBtn = $btn('shop-btn');
  const scoreBtn = $btn('score-btn');
  const chatBtn = $btn('chat-btn');
  const skillBtn = $btn('skill-btn');
  const fullscreenBtn = $btn('fullscreen-btn');
  const rotateHint = $btn('rotate-hint');

  let joyId = null;
  let joyOrigin = { x: 0, y: 0 };
  let lookId = null;
  let lookLast = { x: 0, y: 0 };
  let sprinting = false;

  // 摇杆：方向位 + 推程。推程用于自动疾跑（旧实现丢弃推程，导致触屏无法疾跑）。
  //
  // 动态摇杆：底座跟随手指 —— 底座整体挪到手指当前落点，摇杆头始终居中，
  // 方向向量由"手指相对起手点的位移"给出。这样手指滑到哪底座就跟到哪，
  // 视觉上与手指始终贴合，且不会出现固定圆心时"按歪一点方向就斜"的问题。
  //
  // 注意坐标系：#joy-base 是 #joy-zone 的子元素，absolute 定位相对的是
  // #joy-zone（而非视口）。故 translate 必须减去 zone 原点，否则在任意
  // 非全屏热区下都会整体偏移 zone.top（实测偏 175px，摇杆会跑到屏幕外）。
  const setJoy = (dx, dy, x, y) => {
    window.__touchDebug.joyMoves++;
    window.__touchDebug.joyDX += dx;
    window.__touchDebug.joyDY += dy;
    if (x !== undefined) {
      const zr = joyZone.getBoundingClientRect();
      joyBase.style.transform =
        `translate(${x - zr.left}px, ${y - zr.top}px) translate(-50%, -50%)`;
    }
    const len = Math.hypot(dx, dy);
    const cl = Math.min(len, JOY_MAX);
    const nx = (dx / (len || 1)) * cl;
    const nz = (dy / (len || 1)) * cl;
    knob.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${nz}px))`;
    if (len < JOY_DEAD) {
      input.mvTouch = [0, 0, 0, 0];
      input.mvMag = 0;
      setSprint(false);
      return;
    }
    input.mvTouch = [nz < 0 ? 1 : 0, nz > 0 ? 1 : 0, nx < 0 ? 1 : 0, nx > 0 ? 1 : 0];
    const mag = Math.min(1, len / JOY_MAX);
    input.mvMag = mag;
    // 推满且朝前 → 疾跑。物理层的疾跑条件本就要求 mv[0]（前进），
    // 因此后退/侧移推满不触发，符合直觉。
    if (mag > SPRINT_ON && nz < 0) setSprint(true);
    else if (mag < SPRINT_OFF || nz >= 0) setSprint(false);
  };

  // 疾跑状态同步到 input 与摇杆外观（让自动疾跑可被感知）
  const setSprint = (on) => {
    if (sprinting === on) return;
    sprinting = on;
    input.sprintTouch = on;
    joyBase.classList.toggle('sprinting', on);
    if (on) {
      window.__touchDebug.sprint++;
      if (navigator.vibrate) navigator.vibrate(18);
    }
  };

  // 摇杆待机态：回到左下角提示圈位置（不显示在起手处，避免留残影）
  const idleJoy = () => {
    joyZone.classList.remove('active');
    joyBase.style.transform = '';
    knob.style.transform = 'translate(-50%, -50%)';
    input.mvTouch = [0, 0, 0, 0];
    input.mvMag = 0;
    setSprint(false);
  };

  // 热区内任意落点即摇杆原点。起手点固定下来后，后续 move 都以它为基准算方向。
  joyZone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (joyId !== null) return;      // 已在操控中，忽略第二根手指
    const t = e.changedTouches[0];
    window.__touchDebug.joy++;
    joyId = t.identifier;
    joyOrigin = { x: t.clientX, y: t.clientY };
    joyZone.classList.add('active');
    setJoy(0, 0, joyOrigin.x, joyOrigin.y);
  }, { passive: false });
  joyZone.addEventListener('touchmove', (e) => {
    const t = [...e.changedTouches].find((x) => x.identifier === joyId);
    if (!t) return;
    e.preventDefault();
    // 底座跟到手指当前位置，方向仍相对起手点 —— 两者分离才能同时做到
    // "底座贴着手指"和"推程正确反映手指移动距离"。
    setJoy(t.clientX - joyOrigin.x, t.clientY - joyOrigin.y, t.clientX, t.clientY);
  }, { passive: false });
  const joyEnd = (e) => {
    if ([...e.changedTouches].some((x) => x.identifier === joyId)) {
      joyId = null;
      idleJoy();
    }
  };
  joyZone.addEventListener('touchend', joyEnd);
  joyZone.addEventListener('touchcancel', joyEnd);
  idleJoy();

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

  // 按住型按钮：支持滑动跟手（手指滑出按钮后仍保持按下，
  // 这是手机 FPS 的必备行为——否则射击时手指一抖就断火）。
  const hold = (el, onStart, onEnd, key) => {
    let touchId = null;
    let down = false;
    const press = () => {
      if (down) return;
      down = true;
      el.classList.add('pressed');
      if (navigator.vibrate) navigator.vibrate(12);
      onStart();
    };
    const release = () => {
      if (!down) return;
      down = false;
      el.classList.remove('pressed');
      onEnd();
    };
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.__touchDebug[key]++;
      touchId = e.changedTouches[0].identifier;
      press();
    }, { passive: false });
    el.addEventListener('touchmove', (e) => {
      const t = [...e.changedTouches].find((x) => x.identifier === touchId);
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      const r = el.getBoundingClientRect();
      const inside = t.clientX >= r.left - TOUCH_PAD && t.clientX <= r.right + TOUCH_PAD
                  && t.clientY >= r.top - TOUCH_PAD && t.clientY <= r.bottom + TOUCH_PAD;
      if (inside) press();
      else release();
    }, { passive: false });
    const end = (e) => {
      if (touchId !== null && ![...e.changedTouches].some((x) => x.identifier === touchId)) return;
      touchId = null;
      release();
    };
    el.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); end(e); }, { passive: false });
    el.addEventListener('touchcancel', () => { touchId = null; release(); });
    return { release, el };
  };
  // 轻点型按钮：边沿触发（按下一次 = 动作一次）。
  //
  // 不能复用 hold() —— hold 的 press() 会在 touchmove 滑回按钮内时再次调用 onStart，
  // 而 tap 的业务语义是边沿触发。手机上手指出微汗后几乎不可能完全静止，
  // 一次触摸里"滑出→滑回"会被算成多次点击：
  //   jump/reload/skill  → 重复动作（不易察觉）
  //   ads/crouch         → input.ads = !input.ads 来回翻转，表现为"按了没反应"
  //   切枪               → 连切多把，最后一秒又切回原样，表现为"切不了枪"
  // 故此处独立实现：同一手势只认一次，不挂 touchmove。
  const tap = (el, fn, key) => {
    let fired = false;
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (fired) return;        // 同一手势内重复 touchstart 不重复触发
      fired = true;
      el.classList.add('pressed');
      if (navigator.vibrate) navigator.vibrate(12);
      window.__touchDebug[key]++;
      fn();
    }, { passive: false });
    const reset = () => {
      fired = false;            // 抬手/取消后才允许下一次触发
      el.classList.remove('pressed');
    };
    el.addEventListener('touchend', (e) => { e.stopPropagation(); reset(); }, { passive: false });
    el.addEventListener('touchcancel', reset);
  };

  hold(fireBtn, () => { input.fire = true; }, () => { input.fire = false; }, 'fire');
  hold(useBtn, () => { input.useHeld = true; }, () => { input.useHeld = false; }, 'use');
  tap(jumpBtn, () => { input.jumpQueued = true; }, 'jump');
  // 开镜 / 蹲下是切换态：按钮需保持高亮，否则玩家无法判断当前状态
  tap(adsBtn, () => {
    input.ads = !input.ads;
    adsBtn.classList.toggle('active', input.ads);
  }, 'ads');
  tap(crouchBtn, () => {
    input.crouchHeld = !input.crouchHeld;
    crouchBtn.classList.toggle('active', input.crouchHeld);
  }, 'crouch');
  tap(reloadBtn, () => { input.reloadQueued = true; }, 'reload');
  tap(switchBtn, () => {
    input.swdQueued = 1;
    if (opts.onSwitchRequest) opts.onSwitchRequest(null, 1);
  }, 'switch');
  tap(shopBtn, () => { if (opts.onShop) opts.onShop(); }, 'shop');
  tap(scoreBtn, () => { input.scoreboard = !input.scoreboard; }, 'score');
  tap(chatBtn, () => { if (opts.onChat) opts.onChat(); }, 'chat');
  tap(skillBtn, () => { input.skillQueued = true; }, 'skill');
  tap(fullscreenBtn, () => { toggleFullscreen(); }, 'fullscreen');

  // 全屏：iOS Safari 需要用户手势，故必须由按钮触发（自动请求会静默失败）
  function toggleFullscreen() {
    const d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement) {
      (d.exitFullscreen || d.webkitExitFullscreen)?.call(d);
    } else {
      const el = d.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) {
        const p = req.call(el);
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    }
  }

  // 横屏建议：仅竖屏时显示，可手动关闭，不阻塞游玩
  let rotateDismissed = false;
  function updateRotateHint() {
    if (rotateDismissed) return;
    const portrait = window.matchMedia && window.matchMedia('(orientation: portrait)').matches;
    rotateHint.classList.toggle('hidden', !portrait);
  }
  $btn('rotate-hint-close')?.addEventListener('touchstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
    rotateDismissed = true;
    rotateHint.classList.add('hidden');
  }, { passive: false });
  window.addEventListener('orientationchange', updateRotateHint);
  window.addEventListener('resize', updateRotateHint);
  updateRotateHint();

  window.__touchDebug.ready = true;

  // 供 main.js 控制：技能按钮只在生化模式且自身为丧尸时出现
  // （与 js/hud.js 的 F 加速指示保持同一判定标准）
  ui.setSkillVisible = (visible) => {
    skillBtn.classList.toggle('hidden', !visible);
  };
  ui.setSprint = setSprint;
  ui.setAds = (on) => {
    input.ads = on;
    adsBtn.classList.toggle('active', on);
  };
  ui.setCrouch = (on) => {
    input.crouchHeld = on;
    crouchBtn.classList.toggle('active', on);
  };
  // 丧尸形态只有尸爪，切枪无意义（localCycleWeapon 对丧尸直接 return）。
  // 置灰并屏蔽触摸，避免玩家反复点击却毫无反馈。
  ui.setSwitchEnabled = (on) => {
    switchBtn.classList.toggle('disabled', !on);
    switchBtn.style.pointerEvents = on ? '' : 'none';
  };
  return ui;
}
