// 主循环（VibeHub 版）：登录、加入房间、本地预测、插值渲染、事件接线、菜单/设置。
// 同步模型：state-sync（房主权威）。房主本 tab 跑 30Hz 权威模拟并广播 20Hz 快照，
// 所有客户端（含房主本人）走同一套状态/事件消息渲染。

import * as THREE from 'three';
import { Net } from './net.js';
import { Host } from './host.js';
import { Input } from './input.js';
import { Renderer } from './renderer.js';
import { buildMapMesh } from './maps.js';
import { buildPlayer, buildViewmodel, buildBomb, buildNameTag } from './models.js';
import { Effects } from './effects.js';
import { Hud } from './hud.js';
import { Sfx } from './audio.js';
import { DnB } from './music.js';
import { setupTouch } from './touch.js';
import { loadClientMods, dispatchMods } from './mods.js';
import { CONFIG, resolveWork, VIBE_WORK_PLACEHOLDER } from './config.js';
import { MAPS } from '../shared/maps/index.js';
import { MODE_LABEL, PHYS, ZOMBIE_BOOST_SPEED } from '../shared/constants.js';
import { modeCfg } from '../shared/modes.js';
import { BUILTIN_WEAPONS, shouldFire } from '../shared/weapons.js';
import { movePlayer } from '../shared/physics.js';
import { rayAABB, directionFromAngles, distance, angLerp, lerp, clamp } from '../shared/math.js';
import { registerModWeapons, weaponDef, weaponName } from './weapon-registry.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const renderer = new Renderer(canvas);
const effects = new Effects(renderer.scene, renderer.camera);
const hud = new Hud();
hud.init();
hud.bindChat();
const sfx = new Sfx();
const music = new DnB(sfx);
const net = new Net();
const input = new Input(canvas);
input.attach();
input.onSwitch = (slot) => applyLocalSwitch(slot);
input.onWheel = (dir) => localCycleWeapon(dir);

// touchSens：触控视角专用倍率。与鼠标共用 sens 数值但量纲不同，
// 默认 2.0 使 0.0022×1×2 ≈ 原有固定值 0.0045，升级后手感零回归。
const defaultSettings = {
  sens: 1, touchSens: 2, fov: 75, vol: 0.8, music: true, shadow: true, quality: 'high',
  fps: false, crosshair: '#dcffe6',
  adsMode: 'hold',      // hold=按住开镜 / toggle=切换
  sprintMode: 'hold',   // hold=按住疾跑 / toggle=切换
  btnScale: 1,          // 移动端按钮整体缩放
  haptics: true,        // 命中/受伤震动反馈
};
const settings = loadSettings();

const state = {
  connected: false,
  selfId: null,
  mode: 'defusal',
  map: null,
  mapMesh: null,
  mapGroup: null,
  self: {
    pos: { x: 0, y: 2, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    crouch: false,
    grounded: true,
    alive: false,
    isZombie: false,
    weaponMoveMult: 1,
    correction: { x: 0, y: 0, z: 0 }, // 服务器位置校正量（增量消费，避免抖动）
    reloadAnim: null,                 // 换弹动画状态
    vmRecoil: 0,                      // 近战/开火的额外回弹
  },
  players: new Map(),
  grenadeMeshes: new Map(),
  bomb: null,
  bombMesh: null,
  viewmodel: null,
  vmKick: 0,
  vmSwing: 0,
  lastInputAt: 0,
  lastPingAt: 0,
  lastStateAt: 0,
  round: null,
  lastFootstep: 0,
  lastZombieGrowl: 0,
  mods: [],
  touchUI: null,
  paused: false,
  inGame: false,
  buyOpen: false,
  lastBuyRenderAt: 0,
  lastSbRenderAt: 0,
  viewmodels: {},
  localSwitchAt: 0,
  pendingSlot: null,
  selfPrimaryId: null,   // 已知持有的主武器（由快照/切枪回执确认，null=当前没有主武器）
  lastSwitchSeq: 0,
  pendingLocal: null,
  zombieCatalog: [], // 生化模式选枪目录（含 Mod 主武器）
  zombieEquippedId: null,
  adsAmount: 0,       // 0=腰射，1=完全开镜（平滑过渡）
  activeAds: null,    // 开镜参数（关镜回退期间保持，用于补出关镜动画）
  scopeCanvas: null,
  remoteShots: new Map(), // 他人开火的曳光弹节流：id -> 上次时间
  rules: { gravity: 1 },  // 房主下发的规则表（Mod 可改重力/友伤/伤害倍率）
  ggLadder: null,         // 军备竞赛武器阶梯
  scoreLimit: 0,          // 死斗目标击杀数
  selfLevel: 0,           // 军备竞赛当前等级
  lastHudRoundAt: 0,
  fps: 0,
};

// ---------------- 设置 ----------------
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('pfa-settings') || '{}');
    if (saved && Object.keys(saved).length > 0) return { ...defaultSettings, ...saved };
    // 移动端首次进入默认中画质 + 关阴影，保证流畅
    if (('ontouchstart' in window) || navigator.maxTouchPoints > 0) {
      return { ...defaultSettings, quality: 'medium', shadow: false };
    }
    return { ...defaultSettings };
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings() {
  localStorage.setItem('pfa-settings', JSON.stringify(settings));
}

function applySettings() {
  input.sensitivity = settings.sens;
  input.fov = settings.fov;
  input.adsMode = settings.adsMode || 'hold';
  input.sprintMode = settings.sprintMode || 'hold';
  sfx.setVolume(settings.vol);
  renderer.applySettings({ shadow: settings.shadow, quality: settings.quality });
  hud.setCrosshairColor(settings.crosshair || '#dcffe6');
  hud.haptics = !!settings.haptics;
  document.documentElement.style.setProperty('--btn-scale', String(settings.btnScale ?? 1));
  const fpsEl = $('fps');
  if (fpsEl) fpsEl.classList.toggle('hidden', !settings.fps);
}

function bindSettingsUI() {
  $('set-sens').value = settings.sens;
  $('set-touch-sens').value = settings.touchSens ?? 2;
  $('set-fov').value = settings.fov;
  $('set-vol').value = Math.round(settings.vol * 100);
  $('set-music').value = settings.music ? '1' : '0';
  $('set-shadow').value = settings.shadow ? '1' : '0';
  $('set-quality').value = settings.quality;
  $('set-fps').value = settings.fps ? '1' : '0';
  $('set-crosshair').value = settings.crosshair || '#dcffe6';
  $('set-ads').value = settings.adsMode || 'hold';
  $('set-sprint').value = settings.sprintMode || 'hold';
  $('set-btnscale').value = String(settings.btnScale ?? 1);
  $('set-haptics').value = settings.haptics === false ? '0' : '1';
  // 触控灵敏度只对触屏设备有意义，非触屏隐藏该行，避免设置面板出现无效项
  const touchRow = $('set-touch-sens')?.closest('label');
  if (touchRow && !input.isTouchPrimary()) touchRow.classList.add('hidden');
  $('set-sens').oninput = (e) => { settings.sens = +e.target.value; saveSettings(); applySettings(); };
  $('set-touch-sens').oninput = (e) => { settings.touchSens = +e.target.value; saveSettings(); applySettings(); };
  $('set-fov').oninput = (e) => { settings.fov = +e.target.value; saveSettings(); applySettings(); };
  $('set-vol').oninput = (e) => { settings.vol = +e.target.value / 100; saveSettings(); applySettings(); };
  $('set-music').onchange = (e) => {
    settings.music = e.target.value === '1';
    saveSettings();
    if (settings.music) music.start();
    else music.stop();
  };
  $('set-shadow').onchange = (e) => { settings.shadow = e.target.value === '1'; saveSettings(); applySettings(); };
  $('set-quality').onchange = (e) => { settings.quality = e.target.value; saveSettings(); applySettings(); };
  $('set-fps').onchange = (e) => { settings.fps = e.target.value === '1'; saveSettings(); applySettings(); };
  $('set-crosshair').oninput = (e) => { settings.crosshair = e.target.value; saveSettings(); applySettings(); };
  $('set-ads').onchange = (e) => { settings.adsMode = e.target.value; saveSettings(); applySettings(); };
  $('set-sprint').onchange = (e) => { settings.sprintMode = e.target.value; saveSettings(); applySettings(); };
  $('set-btnscale').onchange = (e) => { settings.btnScale = Number(e.target.value); saveSettings(); applySettings(); };
  $('set-haptics').onchange = (e) => { settings.haptics = e.target.value === '1'; saveSettings(); applySettings(); };
  $('settings-close').onclick = () => {
    $('settings').classList.add('hidden');
    // 从暂停菜单进来的，返回暂停面板而不是主菜单
    if (state.inGame) { $('paused').classList.remove('hidden'); return; }
    $('menu').classList.remove('hidden');
  };
  // 军备竞赛是自由混战：隐藏阵营选择，避免给了选项却无效
  $('mode-select').onchange = (e) => {
    const teamRow = $('team-select').closest('.menu-row');
    if (teamRow) teamRow.classList.toggle('hidden', e.target.value === 'gungame');
  };
  $('settings-btn').onclick = () => {
    $('menu').classList.add('hidden');
    $('settings').classList.remove('hidden');
  };
}

// ---------------- VibeHub 初始化 / 登录 ----------------
let vibeInitPromise = null;
function initVibe() {
  if (net.vibe) return Promise.resolve(net.vibe);
  if (vibeInitPromise) return vibeInitPromise;
  if (!window.VibeHub) {
    return Promise.reject(new Error('VibeHub SDK 未加载（需联网访问绝对地址脚本）'));
  }
  const work = resolveWork();
  if (!work || work === VIBE_WORK_PLACEHOLDER) {
    return Promise.reject(new Error('slug 仍为占位值（首次发布后请用 vibehub list 查真实 slug 替换 vibe/js/config.js 的 VIBE_WORK）'));
  }
  vibeInitPromise = window.VibeHub.init({ work }).then((vibe) => {
    net.vibe = vibe;
    return vibe;
  });
  return vibeInitPromise;
}

function renderAuth(user) {
  const logged = !!user;
  $('login-btn').hidden = logged;
  $('logout-btn').hidden = !logged;
  // 本地（localhost）无法完成登录/联机：VibeHub 只认 vibeapps 域的授权回跳
  const onVibeApps = /(^|\.)vibeapps\.lumigrav\.space$/.test(location.hostname);
  $('auth-status').textContent = logged
    ? `已登录：${user.name || user.id}`
    : (onVibeApps ? '未登录（请先登录后再进入对局）' : '本地环境无法登录/联机，请打开已部署地址');
  if (logged && user.name) $('name-input').value = user.name;
  refreshMyStats();
}

// 读取登录玩家的个人战绩（vibe.save）显示在主菜单
async function refreshMyStats() {
  const el = $('my-stats');
  if (!el) return;
  if (!net.vibe?.isLoggedIn || !net.vibe.isLoggedIn()) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  try {
    const s = await net.vibe.save.get('stats');
    const st = (s && typeof s === 'object') ? s : {};
    el.textContent = `战绩：${st.plays || 0} 局 · 胜 ${st.wins || 0} · 击杀 ${st.kills || 0}`;
    el.classList.remove('hidden');
  } catch {
    el.classList.add('hidden');
    el.textContent = '';
  }
}

function bindAuthUI() {
  $('login-btn').onclick = () => initVibe().then((v) => v.login()).catch((err) => hud.toast('登录失败：' + (err?.message || '网络错误')));
  $('logout-btn').onclick = () => { if (net.vibe) net.vibe.logout(); };
  initVibe()
    .then((vibe) => {
      vibe.onAuthChange((user) => renderAuth(user));
      renderAuth(vibe.user || null);
    })
    .catch((err) => {
      console.warn('[vibe] init failed', err);
      $('auth-status').textContent = 'VibeHub 初始化失败：' + (err?.message || '');
      $('login-btn').hidden = true;
      $('logout-btn').hidden = true;
    });
}

// ---------------- 菜单 / 连接 ----------------
async function connect() {
  const name = $('name-input').value.trim() || '战士';
  const mode = $('mode-select').value;
  const team = $('team-select').value;
  const roomCode = $('room-input').value.trim();
  const bots = Number($('bot-select')?.value ?? 8);
  const botSkill = Number($('difficulty-select')?.value ?? 1);
  $('menu').classList.add('hidden');
  $('loading').classList.remove('hidden');
  $('loading-text').textContent = '初始化 VibeHub…';
  try {
    await initVibe();
    // 平台要求：建房/进房/数据接口都必须携带游戏 token，未登录会返回 401「未授权」。
    // 因此进入对局前必须完成登录；登录弹窗需允许浏览器弹窗。
    if (!net.vibe.isLoggedIn()) {
      $('loading-text').textContent = '请先登录 VibeHub 账号…';
      try {
        await net.vibe.login();
      } catch (e) {
        throw new Error('未登录，请先点击「登录」完成授权');
      }
    }
    $('loading-text').textContent = '加入房间…';
    const res = await net.join({
      name,
      mode,
      team,
      roomId: roomCode || undefined,
      quick: !roomCode,
      bots,
      botSkill,
    });
    // 加入后等待 welcome（房主本地同步派发 / 远程经 P2P 到达），welcome 事件进入游戏
    window.__joinResult = res;
  } catch (err) {
    console.error('[connect]', err);
    net.leave();
    $('loading').classList.add('hidden');
    $('menu').classList.remove('hidden');
    const m = (err?.message || '') + '';
    const needLogin = err?.code === 'AUTH_EXPIRED' || err?.status === 401
      || /未授权|授权已过期|请先登录|登录/.test(m);
    hud.toast(needLogin ? '请先点击「登录」按钮完成 VibeHub 授权后再进入对局' : ('加入失败：' + (err?.message || '网络错误')));
    if (needLogin) $('login-btn').focus();
  }
}

// 离线模式：完全本地、与 VibeHub 联机完全平行。不 init VibeHub、不 join/announce 房间，
// 只用 Host+Room 在本地跑一个只有 Bot 的房间，走与房主一致的本地回环协议（welcome 等照常）。
// 因此正常玩家永远匹配不到它，离线房间之间也互不可见，退出即销毁、对主版零影响。
async function connectOffline() {
  const name = $('name-input').value.trim() || '战士';
  const mode = $('mode-select').value;
  const team = $('team-select').value;
  const bots = Number($('bot-select')?.value ?? 8);
  const botSkill = Number($('difficulty-select')?.value ?? 1);
  $('menu').classList.add('hidden');
  $('loading').classList.remove('hidden');
  $('loading-text').textContent = '启动离线房间…';
  try {
    if (net.connected || net.host) net.leave(); // 清掉可能残留的联机状态
    net.offline = true;
    net.connected = false;
    net.isHost = true;
    net.peerId = 'offline-local';
    net.hostPeerId = null;
    net.room = null;
    net.host = new Host(net);
    // host.init 内部 start 本地 Room、加入玩家并本地回环 dispatch welcome → enterGame
    await net.host.init({ name, mode, team, bots, botSkill });
    net.connected = true;
    window.__joinResult = { isHost: true, roomId: null, offline: true };
  } catch (err) {
    console.error('[offline] start failed', err);
    net.leave();
    $('loading').classList.add('hidden');
    $('menu').classList.remove('hidden');
    hud.toast('离线模式启动失败：' + (err?.message || '未知错误'));
  }
}

function enterGame(welcome) {
  if (state.connected) return; // 重复 welcome（房主重发握手）时忽略
  state.connected = true;
  net.connected = true;
  state.selfId = welcome.id;
  state.selfName = $('name-input').value.trim() || '战士';
  hud.selfId = welcome.id;
  state.mode = welcome.mode;
  state.modeCfg = modeCfg(welcome.mode);
  state.rules = welcome.rules || { gravity: 1 };
  state.ggLadder = welcome.ladder || null;
  state.scoreLimit = welcome.scoreLimit || 0;
  state.selfLevel = 0;
  state.map = MAPS[welcome.map] || MAPS.vertex;
  hud.setMode(welcome.mode, welcome.modeLabel, { scoreLimit: welcome.scoreLimit });
  hud.setLadder(welcome.ladder || null, 0);
  hud.setStatus(true);
  // 显示房间码，方便把 code 分享给朋友在「房间码」输入框加入
  if (net.roomId) {
    const rc = $('room-code');
    rc.textContent = '房间：' + net.roomId;
    rc.onclick = () => copyRoomCode();
  }
  $('loading').classList.add('hidden');
  $('hud').classList.remove('hidden');
  state.inGame = true;
  state.paused = false;
  // 输入层只在局内接管 Tab / 数字键 / 空格，避免在主菜单里按 Tab 切不了焦点
  input.active = true;
  input.yaw = 0;
  input.pitch = 0;
  state.selfPrimaryId = null;
  state.remoteShots.clear();
  hud.reset();
  sfx.startAmbient(state.map.ambient || 'outdoor');
  // 操作提示只在开局露一会儿：常驻会与右下角武器槽重叠，且老玩家不需要
  const hint = document.getElementById('hint');
  hint.classList.remove('faded');
  clearTimeout(state.hintTimer);
  state.hintTimer = setTimeout(() => hint.classList.add('faded'), 12000);

  renderer.setupSky(state.map.sky);
  renderer.setupLights(state.map);
  applySettings();
  state.mapGroup = buildMapMesh(state.map);
  renderer.scene.add(state.mapGroup);
  rebuildViewmodel('k9');
  renderer.scene.add(renderer.camera);
  renderer.setupViewmodelLight();
  state.localSwitchAt = 0;

  const modeText = welcome.modeLabel || MODE_LABEL[welcome.mode] || '对局';
  hud.banner(`进入 ${modeText}`, `${welcome.mapName} · ${welcome.mods?.length ? `已加载 ${welcome.mods.length} 个 Mod` : '无 Mod'}`);
  sfx.roundStart();

  state.touchUI = setupTouch(input, (dx, dy) => {
    // 触控视角：0.0022 与鼠标同一量纲，× touchSens 补偿触屏与鼠标的手感差异。
    // 读 effectiveSens（= settings.sens × ADS 倍率）而非写死常数，
    // 这样设置里的灵敏度对触屏生效，开镜后也会按倍率降速。
    const s = 0.0022 * (input.effectiveSens || 1) * (settings.touchSens ?? 2);
    input.yaw -= dx * s;
    input.pitch = clamp(input.pitch - dy * s, -1.55, 1.55);
  }, {
    onShop: () => {
      toggleBuy(); // 拆弹=购买菜单，生化=选枪界面
    },
    onSwitchRequest: (slot, dir) => {
      if (slot != null) applyLocalSwitch(slot);
      else if (dir) localCycleWeapon(dir);
    },
    onChat: openMobileChat,
    onGrenade: throwGrenadeQuick,
  });
  if (state.touchUI) {
    hud.r.hint.classList.add('hidden');
    // 生化模式：商店按钮用于打开“选枪”，保留并改标签；拆弹模式为购买菜单
    if (state.mode !== 'defusal') {
      const shopBtn = document.getElementById('shop-btn');
      const label = shopBtn?.querySelector('.btn-label');
      if (label) label.textContent = '选枪';
    }
    // 触屏进入对局时尝试全屏：移动浏览器地址栏会持续占位，
    // 横屏下尤其压缩可视区。iOS 需用户手势，失败静默（顶部操作条另有全屏按钮兜底）。
    try {
      const el = document.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req && !document.fullscreenElement) {
        const p = req.call(el);
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } catch {
      // 不支持全屏/方向锁的环境：忽略，不影响游玩
    }
  }

  loadClientMods({ net, hud, state, settings }).then((mods) => {
    state.mods = mods;
  });
}

function copyRoomCode() {
  const code = net.roomId || '';
  if (!code) return;
  const done = () => hud.toast(`已复制房间码：${code}`);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(code).then(done).catch(() => hud.toast(`房间码：${code}`));
  } else {
    hud.toast(`房间码：${code}`);
  }
}

// 退出房间：非房主直接 leave（房主移除该玩家并补 Bot，房间保留）；
// 房主退出会结束本局并关闭/下架房间（房主是权威，SDK 不做权威迁移）。
function leaveRoom() {
  hud.setPaused(false);
  if (net.isHost && net.host) {
    net.host.shutdown();
  } else {
    net.leave();
  }
  backToMenu();
  hud.toast('已退出房间');
}

// 统一暂停状态：HUD + 触控 UI（暂停时禁用触控层，避免挡到暂停面板/退出按钮）
function setPaused(flag) {
  state.paused = flag;
  hud.setPaused(flag);
  if (state.touchUI) state.touchUI.classList.toggle('touch-disabled', flag);
  // 离线模式：本机就是房主且没有别的真人，暂停时把权威模拟一起冻结，
  // 否则"暂停"期间回合计时、复活倒计时、炸弹倒计时仍在走（联机模式不能冻结，那等于作弊）。
  if (net.offline && net.host?.room) net.host.room.paused = flag;
}

// 打开暂停菜单：火狐按 Esc 只会释放鼠标（不触发 pointerlockchange 暂停），
// 因此提供 HUD 右上角 ☰ 按钮与“=”键作为可靠的暂停入口。
function openPauseMenu() {
  if (!state.inGame) return;
  document.exitPointerLock();
  setPaused(true);
  sfx.click();
}

// “=”键：暂停/恢复切换
function togglePause() {
  if (!state.inGame) return;
  if (state.paused) {
    setPaused(false);
    if (!hud.chatOpen) input.requestLock();
  } else {
    openPauseMenu();
  }
}

// 移动端聊天：无键盘时通过触控按钮打开聊天输入
function openMobileChat() {
  if (!state.inGame || state.paused) return;
  hud.openChat(
    (text) => net.chat(text),
    () => {
      input.chatOpen = false;
      input.requestLock();
    }
  );
  document.exitPointerLock();
  input.chatOpen = true;
}

function backToMenu() {
  state.connected = false;
  state.inGame = false;
  input.active = false;
  sfx.stopAmbient();
  hud.reset();
  net.leave();
  $('room-code').textContent = '';
  state.adsAmount = 0;
  state.activeAds = null;
  if (state.scopeCanvas) {
    state.scopeCanvas.remove();
    state.scopeCanvas = null;
  }
  // 重置武器状态，避免跨房间残留（如生化买过的 AE-7 在拆弹局闪出）
  state.selfWeaponId = null;
  state.selfPrimaryId = null;
  state.self.speedOverride = undefined;
  state.self.skillCd = 0;
  state.zombieCatalog = [];
  state.zombieEquippedId = null;
  state.pendingLocal = null;
  state.lastSwitchSeq = 0;
  if (state.mapGroup) {
    renderer.scene.remove(state.mapGroup);
    state.mapGroup = null;
  }
  for (const vm of Object.values(state.viewmodels)) renderer.camera.remove(vm);
  state.viewmodels = {};
  state.viewmodel = null;
  if (state.bombMesh) {
    renderer.scene.remove(state.bombMesh);
    state.bombMesh = null;
  }
  for (const rec of state.players.values()) {
    renderer.scene.remove(rec.mesh);
    if (rec.tag) renderer.scene.remove(rec.tag);
  }
  state.players.clear();
  state.touchUI?.remove();
  state.touchUI = null;
  $('hud').classList.add('hidden');
  $('menu').classList.remove('hidden');
  $('loading').classList.add('hidden');
  hud.setStatus(false);
}

// ---------------- 战绩持久化（低频，符合数据分层） ----------------
function persistMatch(msg) {
  const my = state.self;
  const myTeam = my.team === 1 ? (state.mode === 'defusal' ? 'CT' : 'HUMAN') : (state.mode === 'defusal' ? 'T' : 'ZOMBIE');
  const won = msg.winner === myTeam;
  // 玩家战绩 → vibe.save（本人读写）
  if (net.vibe?.isLoggedIn && net.vibe.isLoggedIn()) {
    net.vibe.save.get('stats')
      .then((s) => {
        const prev = (s && typeof s === 'object') ? s : {};
        const next = {
          plays: (prev.plays || 0) + 1,
          wins: (prev.wins || 0) + (won ? 1 : 0),
          kills: (prev.kills || 0) + (my.kills || 0),
          deaths: (prev.deaths || 0) + (my.deaths || 0),
          lastMode: state.mode,
        };
        return net.vibe.save.set('stats', next);
      })
      .then(() => refreshMyStats())
      .catch(() => {});
  }
  // 房主：当局结果写 room.data（单局共享；vibe.global 仅作品创作者可写，房主无法维护全服排行）。
  // 离线模式无 VibeHub room，跳过。
  if (net.isHost && net.room) {
    net.room?.data?.set('last_match', {
      winner: msg.winner,
      mode: state.mode,
      scores: msg.scores,
      at: Date.now(),
    }).catch(() => {});
  }
}

// ---------------- 事件接线 ----------------
function wireEvents() {
  net.on('*', (msg) => {
    if (msg.type !== 'state' && state.mods.length) {
      dispatchMods(state.mods, msg.type, msg);
    }
  });
  // 客户端 Mod 可以订阅任意协议消息（kill/damage/hit/shot_fx/round_* …）
  net.on('*', (msg) => dispatchMods(state.mods, msg && msg.type, msg));
  net.on('welcome', (msg) => enterGame(msg));
  net.on('error', (msg) => {
    $('loading').classList.add('hidden');
    $('menu').classList.remove('hidden');
    hud.toast(msg.message || '服务器错误');
  });
  net.on('net_close', (msg) => {
    if (state.inGame) {
      hud.toast(msg?.reason === 'host_left' ? '房主已离开，对局结束' : '连接已断开');
      backToMenu();
    }
  });

  net.on('state', (msg) => handleState(msg));

  net.on('kill', (msg) => {
    // 优先用房主下发的名字；旧版房主无名字时再本地查（自己不在 state.players 里，用 selfName 兜底）
    msg.killerName = msg.killerName || state.players.get(msg.killer)?.next?.n || (msg.killer === state.selfId ? state.selfName : null);
    msg.victimName = msg.victimName || state.players.get(msg.victim)?.next?.n || (msg.victim === state.selfId ? state.selfName : null);
    hud.addKillFeed(msg);
    const victim = state.players.get(msg.victim);
    if (victim) {
      const p = victim.next;
      effects.impact({ x: p.x, y: p.y + 1, z: p.z }, 'blood');
      // 倒地动画：先塌下去再隐藏，比"瞬间消失"清楚得多（尤其远距离击杀）
      victim.death = { t: 0, dur: 0.62, baseY: victim.mesh.position.y || p.y };
      victim.mesh.visible = true;
      if (victim.tag) victim.tag.visible = false;
    }
    if (msg.victim === state.selfId) {
      hud.damageFlash();
      hud.setDeathInfo(msg.killerName, msg.weapon, msg.headshot);
    }
    if (msg.victim === state.selfId && !msg.zombie) {
      sfx.roundEnd(false);
    }
    if (msg.killer === state.selfId) {
      sfx.kill();
      hud.killConfirm(msg.headshot, msg.weapon);
    }
    dispatchMods(state.mods, 'kill', msg);
  });
  net.on('damage', (msg) => {
    hud.damageFlash();
    sfx.damage();
    // 受击方向指示：用攻击者当前位置算相对方位，玩家不用回头也知道该往哪防
    if (msg.from && msg.from !== state.selfId) {
      const rec = state.players.get(msg.from);
      if (rec) {
        const dx = rec.next.x - state.self.pos.x;
        const dz = rec.next.z - state.self.pos.z;
        const rel = Math.atan2(dx, dz) - state.self.yaw;
        hud.damageDirection(rel);
      }
    } else if (msg.from === state.selfId) {
      hud.damageDirection(0);
    }
    dispatchMods(state.mods, 'damage', msg);
  });
  net.on('hit', (msg) => {
    hud.hitmarker(msg.headshot);
    sfx.hit(msg.headshot);
    if (msg.headshot) sfx.ding();
    hud.damageNumber(msg.dmg, msg.headshot);
    dispatchMods(state.mods, 'hit', msg);
  });
  // 他人开火：曳光弹 + 枪口焰 + 空间化枪声 + 近失弹呼啸
  net.on('shot_fx', (msg) => {
    if (msg.id === state.selfId || !state.map) return;
    const now = performance.now();
    const last = state.remoteShots.get(msg.id) || 0;
    if (now - last < 45) return; // 连发武器每帧都画会糊成一片
    state.remoteShots.set(msg.id, now);
    const o = { x: msg.o[0], y: msg.o[1], z: msg.o[2] };
    const dir = { x: msg.d[0], y: msg.d[1], z: msg.d[2] };
    const rec = state.players.get(msg.id);
    // 枪口位置：从模型前方偏移一点，避免火焰从眼睛里喷出来
    const muzzle = { x: o.x + dir.x * 0.45, y: o.y - 0.16 + dir.y * 0.45, z: o.z + dir.z * 0.45 };
    effects.muzzleAt(muzzle, dir, msg.ads ? 0.16 : 0.24);
    const sp = sfx.space(o);
    if (sp.dist < 90) {
      const pellets = Math.min(4, msg.n || 1);
      for (let i = 0; i < pellets; i++) {
        const spread = pellets > 1 ? 0.055 : 0.012;
        const d2 = {
          x: dir.x + (Math.random() - 0.5) * spread,
          y: dir.y + (Math.random() - 0.5) * spread,
          z: dir.z + (Math.random() - 0.5) * spread,
        };
        const len = Math.hypot(d2.x, d2.y, d2.z) || 1;
        d2.x /= len; d2.y /= len; d2.z /= len;
        let maxT = 90;
        for (const box of state.map.colliders) {
          const t = rayAABB(o, d2, box.min, box.max);
          if (t < maxT) maxT = t;
        }
        const to = { x: o.x + d2.x * maxT, y: o.y + d2.y * maxT, z: o.z + d2.z * maxT };
        if (msg.w === 'railgun' || msg.w === 'energy_rifle') effects.beam(muzzle, to, 0x7fe0ff, 0.03);
        else effects.tracer(muzzle, to, msg.w === 'longshot' ? 0xffd9a0 : 0xa8d8ff);
        // 近失弹：弹道离相机 2.2m 以内 → 呼啸声
        const cam = renderer.camera.position;
        if (distPointSegment(cam, muzzle, to) < 2.2 && sp.dist > 1.5) sfx.whiz({ x: muzzle.x, y: muzzle.y, z: muzzle.z });
      }
    }
    sfx.shot(remoteShotSound(msg.s, msg.w), o);
    if (rec) {
      // 受击/开火轻微后仰：直接体现在模型上，远处也能看出"这人在开枪"
      rec.flinch = 1;
    }
  });
  net.on('explosion', (msg) => {
    effects.explosion(msg.pos);
    sfx.explosion(msg.pos);
    if (state.self.alive && distance(state.self.pos, msg.pos) < 12) hud.damageFlash();
    dispatchMods(state.mods, 'explosion', msg);
  });
  net.on('bomb_planted', (msg) => {
    hud.hideUseProgress();
    hud.banner('炸弹已安放！', 'CT 方请立即拆除（E）');
    sfx.plant();
    effects.plantBeacon(msg.pos);
    dispatchMods(state.mods, 'bomb_planted', msg);
  });
  net.on('bomb_pickup', () => {
    hud.toast('已拾取炸弹，前往安放点按 E 安放');
    sfx.pickup();
  });
  net.on('bomb_dropped', () => {
    hud.toast('炸弹掉落，T 方可走近按 E 拾取');
  });
  net.on('bomb_defused', (msg) => {
    hud.hideUseProgress();
    hud.banner('炸弹已拆除！', 'CT 方获胜');
    sfx.defuse();
    dispatchMods(state.mods, 'bomb_defused', msg);
  });
  net.on('bomb_exploded', (msg) => {
    hud.hideUseProgress();
    hud.banner('炸弹爆炸！', 'T 方获胜');
    sfx.explosion();
    effects.explosion(msg.pos);
    dispatchMods(state.mods, 'bomb_exploded', msg);
  });
  net.on('round_start', (msg) => {
    hud.hideUseProgress();
    const cfg = modeCfg(state.mode);
    hud.banner(cfg.rounds ? `第 ${msg.round} 回合开始` : '对局开始', MODE_LABEL[state.mode]);
    if (state.mode === 'defusal') hud.toast('购买结束，回合开始');
    sfx.roundStart();
    dispatchMods(state.mods, 'round_start', msg);
  });
  net.on('buy_phase', (msg) => {
    hud.hideUseProgress();
    hud.banner('购买阶段开始', '按 B 打开购买菜单');
    sfx.click();
  });
  net.on('round_end', (msg) => {
    hud.hideUseProgress();
    const ffa = state.mode === 'gungame';
    const myTeam = state.mode === 'defusal' || state.mode === 'tdm'
      ? (state.self.team === 1 ? 'CT' : 'T')
      : (state.self.team === 1 ? 'HUMAN' : 'ZOMBIE');
    const win = ffa ? msg.winnerId === state.selfId : msg.winner === myTeam;
    const winPhrases = ['漂亮！', '干净利落！', '拿下这一分！'];
    const losePhrases = ['可惜…', '下一回合扳回来', '稳住心态'];
    const flavor = (win ? winPhrases : losePhrases)[(msg.round || 1) % 3];
    const subtitle = modeCfg(state.mode).rounds
      ? `第 ${msg.round || '?'} 回合 · ${reasonText(msg.reason)} · ${flavor}`
      : `${modeCfg(state.mode).label} 结束 · ${reasonText(msg.reason)}`;
    hud.banner(winnerText(msg), subtitle, win);
    sfx.roundEnd(!!win);
    dispatchMods(state.mods, 'round_end', msg);
  });
  net.on('match_end', (msg) => {
    hud.banner('比赛结束', `胜者：${msg.winnerName || msg.winner}`);
    sfx.roundEnd(true);
    persistMatch(msg);
    dispatchMods(state.mods, 'match_end', msg);
  });
  // 军备竞赛：开局阶梯 / 升级 / 夺冠
  net.on('rules', (msg) => {
    state.rules = msg.rules || state.rules;
    dispatchMods(state.mods, 'rules', msg);
  });
  net.on('gg_start', (msg) => {
    state.ggLadder = msg.ladder || state.ggLadder;
    hud.setLadder(state.ggLadder, 0);
  });
  net.on('gg_level', (msg) => {
    if (msg.id === state.selfId) {
      state.selfLevel = msg.level;
      hud.setLadder(state.ggLadder, msg.level);
      hud.toast(`升级！${msg.weapon ? weaponName(msg.weapon) : ''}  Lv ${msg.level + 1}`);
      sfx.buy();
    } else {
      hud.addKillFeed({ type: 'sys', text: `${msg.name || '玩家'} 升到 Lv ${msg.level + 1}` });
    }
    dispatchMods(state.mods, 'gg_level', msg);
  });
  net.on('gg_win', (msg) => {
    hud.banner(`${msg.name || '玩家'} 用匕首夺冠`, '军备竞赛结束');
    sfx.roundEnd(msg.id === state.selfId);
  });
  net.on('infected', (msg) => {
    if (msg.id === state.selfId) {
      hud.banner('你被感染了！', '成为僵尸，感染所有人类');
      sfx.zombie();
    }
    dispatchMods(state.mods, 'infected', msg);
  });
  net.on('chat', (msg) => {
    hud.addChat(msg.name, msg.text, msg.system);
    dispatchMods(state.mods, 'chat', msg);
  });
  net.on('player_joined', (msg) => {
    hud.addChat('系统', `${msg.name} 加入了房间`, true);
  });
  net.on('player_left', (msg) => {
    hud.addChat('系统', `${msg.name} 离开了房间`, true);
    const rec = state.players.get(msg.id);
    if (rec) {
      renderer.scene.remove(rec.mesh);
      if (rec.tag) renderer.scene.remove(rec.tag);
      state.players.delete(msg.id);
    }
  });
  net.on('ammo_refill', () => {
    hud.toast('弹药已补给');
    sfx.pickup();
  });
  net.on('health_refill', () => {
    hud.toast('生命已回复');
    sfx.pickup();
  });
  net.on('health_box', (msg) => {
    effects.impact({ x: msg.pos.x, y: msg.pos.y + 0.8, z: msg.pos.z }, 'heal');
  });
  net.on('finale_start', (msg) => {
    const parts = [];
    if (msg.hunters > 0) parts.push(`${msg.hunters} 名琉璃猎人`);
    if (msg.king) parts.push(`尸王 ${msg.king}`);
    if (msg.servants > 0) parts.push(`${msg.servants} 只尸仆`);
    hud.banner('琉璃决战 · 不死不休', (parts.length ? parts.join(' · ') : '最终决战') + ' · 死亡不再复活');
    sfx.roundStart();
    dispatchMods(state.mods, 'finale_start', msg);
  });
  net.on('zombie_boost', () => {
    hud.toast('丧尸加速！F 技能冷却 20 秒');
    sfx.boost();
  });
  net.on('zombie_boost_visual', (msg) => {
    const rec = state.players.get(msg.id);
    if (rec) effects.impact({ x: rec.next.x, y: rec.next.y + 1, z: rec.next.z }, 'spark');
    sfx.boost();
  });
  net.on('reloading', (msg) => {
    // 换弹动画/音效都以该武器真实 reloadTime 为时长，动画与服务器逻辑同步收尾
    const def = weaponDef(msg?.weapon || state.selfWeaponId) || {};
    const dur = def.reloadTime || 1.8;
    sfx.reload(def.sound || 'rifle', dur);
    state.self.reloadAnim = { t: 0, dur: Math.max(0.4, dur) };
    // 弹匣掉落：从枪身位置往右下掉，是第一人称"真的在换弹"的关键细节
    if (state.viewmodel && !def.melee && !def.projectile) {
      const wp = state.viewmodel.localToWorld(new THREE.Vector3(0, -0.16, 0.06));
      effects.magDrop(wp);
    }
  });
  net.on('use_progress', (msg) => {
    hud.showUseProgress(msg.action, msg.progress);
    const step = Math.floor(msg.progress * 10);
    if (step !== state.lastUseStep) {
      state.lastUseStep = step;
      sfx.tick();
    }
  });
  net.on('buy_ok', () => {
    hud.toast('购买成功');
    sfx.buy();
  });
  net.on('buy_fail', (msg) => {
    hud.toast(`购买失败：${msg.reason === 'money' ? '资金不足' : msg.reason === 'phase' ? '不在购买阶段' : '无法购买'}`);
  });
  net.on('weapon_catalog', (msg) => {
    const items = Array.isArray(msg.items) ? msg.items : [];
    registerModWeapons(items.map((i) => i.def));
    state.zombieCatalog = items;
    state.zombieEquippedId = msg.equipped || null;
  });
  net.on('zselect_ok', (msg) => {
    state.zombieEquippedId = msg.item;
  });
  net.on('refund_ok', () => {
    hud.toast('退款成功');
    sfx.buy();
  });
  net.on('refund_fail', (msg) => {
    hud.toast(`退款失败：${msg.reason === 'phase' ? '不在购买阶段' : '未购买该装备'}`);
  });
  net.on('map_change', (msg) => rebuildMap(msg));
  net.on('pong', (msg) => {
    hud.setPing(Math.round(performance.now() - msg.t));
  });
  // 诊断计数器：各武器实际射速（房主 shot 事件）
  net.on('switch', (msg) => {
    state.lastSwitchSeq = msg.seq ?? state.lastSwitchSeq;
    if (msg.slot === 2 && msg.w) state.selfPrimaryId = msg.w;
    if (state.pendingLocal && msg.w === state.pendingLocal.w) state.pendingLocal = null; // 房主已确认
    if (msg.w && msg.w !== state.selfWeaponId) {
      state.selfWeaponId = msg.w;
      rebuildViewmodel(msg.w);
      window.__viewmodelWeapon = msg.w;
    }
  });
  net.on('shot', (msg) => {
    window.__shotsByWeapon = window.__shotsByWeapon || {};
    window.__shotsByWeapon[msg.weapon] = (window.__shotsByWeapon[msg.weapon] || 0) + 1;
  });
  net.on('mod', (msg) => {
    dispatchMods(state.mods, `mod:${msg.type || ''}`, msg.payload);
  });
  net.on('player_spawn', (msg) => {
    // 自己出生/复活：把视角对齐房主给的出生朝向，避免复活后盯着墙
    if (msg.id === state.selfId && Number.isFinite(msg.yaw)) {
      input.yaw = msg.yaw;
      input.pitch = 0;
    }
    if (msg.id === state.selfId) sfx.roundStart();
  });
}

function winnerText(msg) {
  if (msg.winner === 'FFA') return msg.winnerName ? `${msg.winnerName} 夺冠` : '对局结束';
  const map = {
    CT: 'CT 方获胜', T: 'T 方获胜', HUMAN: '人类获胜！', ZOMBIE: '僵尸获胜！', DRAW: '平局',
  };
  return map[msg.winner] || msg.winner;
}

function reasonText(reason) {
  return {
    elimination: '对方全灭',
    explosion: '炸弹爆炸',
    defused: '炸弹被拆除',
    timeout: '时间耗尽',
    survived: '人类存活至时间结束',
    infected_all: '所有人类已被感染',
    zombies_eliminated: '丧尸全灭',
    mutual_annihilation: '同归于尽',
  }[reason] || '';
}

// 点到线段的最近距离（用于判断子弹是否从耳边擦过）
function distPointSegment(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const apz = p.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / len2)) : 0;
  const dx = apx - abx * t;
  const dy = apy - aby * t;
  const dz = apz - abz * t;
  return Math.hypot(dx, dy, dz);
}

// 服务端只给 sound 名，Mod 武器可能给了内置音效表里没有的值 → 回落到按 id 判断
function remoteShotSound(snd, id) {
  const known = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'lmg', 'energy', 'cryo', 'rail'];
  if (snd && known.includes(snd)) return snd;
  if (id === 'railgun') return 'rail';
  if (id === 'energy_rifle') return 'energy';
  if (id === 'cryo_gun') return 'cryo';
  return 'rifle';
}

// ---------------- 快照与插值 ----------------
function handleState(msg) {
  state.lastStateAt = performance.now();
  state.round = msg.r;
  state.snap = msg; // 供记分板读取（含全部玩家击杀/死亡/得分）
  const seen = new Set();
  let selfEntry = null;
  for (const e of msg.p) {
    seen.add(e.i);
    if (e.i === state.selfId) {
      selfEntry = e;
      continue;
    }
    let rec = state.players.get(e.i);
    if (!rec) {
      const mesh = buildPlayer({ zombie: !!e.zb, team: e.t });
      mesh.position.set(e.x, e.y, e.z);
      mesh.rotation.y = e.ya;
      renderer.scene.add(mesh);
      const tag = buildNameTag(e.n, e.h, e.mx || (e.zb ? PHYS.ZOMBIE_HP : 100), !!e.zb, e.t, !!e.bc, e.ft || 0);
      renderer.scene.add(tag);
      rec = {
        last: e, next: e, t0: performance.now(), mesh, tag,
        zombie: !!e.zb, team: e.t,
        tagHp: -1, tagName: '', tagZombie: null, tagTeam: null, tagCarrier: null, tagMax: -1, tagFt: -1,
        alive: !!e.al, crouch: 0, pitch: 0, speed: 0, death: null, flinch: 0,
        lastX: e.x, lastZ: e.z, lastT: performance.now(),
        phase: Math.random() * Math.PI * 2,
      };
      state.players.set(e.i, rec);
      window.__nameTagCount = state.players.size;
    } else {
      rec.last = rec.next;
      rec.next = e;
      rec.t0 = performance.now();
      if (rec.zombie !== !!e.zb || rec.team !== e.t) {
        renderer.scene.remove(rec.mesh);
        const mesh = buildPlayer({ zombie: !!e.zb, team: e.t });
        mesh.position.set(e.x, e.y, e.z);
        renderer.scene.add(mesh);
        rec.mesh = mesh;
        rec.zombie = !!e.zb;
        rec.team = e.t;
        rec.parts = null;
      }
    }
    rec.alive = !!e.al;
    rec.crouch = e.cr ? 1 : 0;
    rec.pitch = e.pi || 0;
    // 位移速度（用于行走/奔跑动画）：按快照间隔归一化后做指数平滑，避免抖动
    const nowMs = performance.now();
    const dts = Math.max(0.03, (nowMs - rec.lastT) / 1000);
    const inst = Math.hypot(e.x - rec.lastX, e.z - rec.lastZ) / dts;
    rec.speed = rec.speed + (Math.min(12, inst) - rec.speed) * Math.min(1, dts * 8);
    rec.lastX = e.x;
    rec.lastZ = e.z;
    rec.lastT = nowMs;
    if (rec.alive) {
      rec.mesh.visible = true;
      rec.death = null;
    } else if (!rec.death) {
      rec.mesh.visible = false;
      if (rec.tag) rec.tag.visible = false;
    }
    if (rec.tag && (rec.tagHp !== e.h || rec.tagName !== e.n || rec.tagZombie !== !!e.zb || rec.tagTeam !== e.t || rec.tagCarrier !== !!e.bc || rec.tagMax !== (e.mx || 0) || rec.tagFt !== (e.ft || 0))) {
      rec.tagHp = e.h;
      rec.tagName = e.n;
      rec.tagZombie = !!e.zb;
      rec.tagTeam = e.t;
      rec.tagCarrier = !!e.bc;
      rec.tagMax = e.mx || 0;
      rec.tagFt = e.ft || 0;
      rec.tag.userData.hp = e.h;
      rec.tag.userData.name = e.n;
      rec.tag.userData.zombie = !!e.zb;
      rec.tag.userData.team = e.t;
      rec.tag.userData.carrier = !!e.bc;
      rec.tag.userData.maxHp = e.mx || 100;
      rec.tag.userData.ft = e.ft || 0;
      rec.tag.userData.redraw();
    }
  }
  // 快照里没出现的玩家（离房/换图）直接清理
  for (const [id, rec] of state.players) {
    if (!seen.has(id)) {
      renderer.scene.remove(rec.mesh);
      if (rec.tag) renderer.scene.remove(rec.tag);
      state.players.delete(id);
    }
  }

  // 投掷物
  const projSeen = new Set();
  for (const p of msg.proj || []) {
    projSeen.add(p.id);
    let m = state.grenadeMeshes.get(p.id);
    if (!m) {
      m = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x5c6b3a, roughness: 0.5 })
      );
      renderer.scene.add(m);
      state.grenadeMeshes.set(p.id, m);
    }
    m.position.set(p.x, p.y, p.z);
  }
  for (const [id, m] of state.grenadeMeshes) {
    if (!projSeen.has(id)) {
      renderer.scene.remove(m);
      state.grenadeMeshes.delete(id);
    }
  }

  // 炸弹：carried → 无实体（跟随携带者，头顶有标记）；physical/planted → 显示实体炸弹
  hud.setBomb(msg.b || null);
  const b = msg.b;
  if (b) {
    if (b.carried) {
      if (state.bombMesh) {
        renderer.scene.remove(state.bombMesh);
        state.bombMesh = null;
      }
    } else {
      if (!state.bombMesh) {
        state.bombMesh = buildBomb();
        renderer.scene.add(state.bombMesh);
      }
      state.bombMesh.position.set(b.x, b.y ?? 0, b.z);
      state.bombMesh.userData.planted = !!b.planted;
    }
  } else if (state.bombMesh) {
    renderer.scene.remove(state.bombMesh);
    state.bombMesh = null;
  }

  if (selfEntry) applySelfState(selfEntry);
}

function applySelfState(e) {
  const s = state.self;
  s.alive = !!e.al;
  s.isZombie = !!e.zb;
  s.skillCd = e.sk ?? 0;
  s.speedOverride = e.bo ? ZOMBIE_BOOST_SPEED : undefined;
  s.team = e.t;
  s.money = e.mo ?? 0;
  s.boughtItems = e.bi || [];
  s.kills = e.k ?? s.kills ?? 0;
  s.deaths = e.d ?? s.deaths ?? 0;
  s.armor = e.a ?? 0;
  s.grenades = e.g ?? 0;
  if (e.lv !== undefined && e.lv !== state.selfLevel) {
    state.selfLevel = e.lv;
    hud.setLadder(state.ggLadder, e.lv);
  }
  // 复活倒计时：-1 表示本回合不再复活（拆弹阵亡 / 决战阵亡）
  hud.setRespawn(e.ra ?? -1, e.al ? true : false);
  // 诊断：出生后是否掉出地图
  window.__self = { y: e.y, alive: !!e.al };
  window.__minSelfY = Math.min(window.__minSelfY ?? Infinity, e.y);
  // 服务器校正：本地已做预测 + 碰撞求解，这里只做"误差回拉"，不再逐帧 lerp。
  // 旧实现每帧 lerp 0.18，等于让 30Hz 的房主快照与本地每帧预测互相拉扯，
  // 会造成行走时周期性抖动（快照把位置拽回服务器估算值 → 下一帧又预测出去）。
  // 现改为：小误差写入一个平滑修正量由渲染层按帧衰减消费；大误差才硬同步。
  const dx = e.x - s.pos.x;
  const dy = e.y - s.pos.y;
  const dz = e.z - s.pos.z;
  const d = Math.hypot(dx, dy, dz);
  if (d > 2.8) {
    // 严重偏差（出生、传送、被撞飞）：立即对齐
    s.pos = { x: e.x, y: e.y, z: e.z };
    s.vel = { x: 0, y: 0, z: 0 };
    s.correction = { x: 0, y: 0, z: 0 };
  } else if (d > 0.001) {
    // 平滑校正量：随快照更新，由 updateSelf 按帧率无关的方式逐步清零
    s.correction = { x: dx, y: dy, z: dz };
  }
  window.__posErr = +d.toFixed(3);
  s.ammo = e.am ?? 0;
  window.__snapW = e.w;
  window.__snapWs = e.ws ?? -1;
  window.__lastSeq = state.lastSwitchSeq;
  // 待确认窗口：本地乐观切枪后 500ms 内忽略任何不同的旧快照，避免闪回
  let staleWeapon = false;
  const pending = state.pendingLocal;
  if (pending) {
    if (e.w === pending.w) {
      state.pendingLocal = null; // 快照确认
    } else if (performance.now() - pending.at < 500) {
      staleWeapon = true; // 尚未确认，忽略旧快照
    } else {
      state.pendingLocal = null; // 超时，接受房主权威
    }
  }
  staleWeapon = staleWeapon || ((e.ws ?? 0) < state.lastSwitchSeq && e.w !== state.selfWeaponId);
  if (e.w !== state.selfWeaponId && !staleWeapon) {
    const first = !state.selfWeaponId;
    state.selfWeaponId = e.w;
    rebuildViewmodel(e.w);
    window.__viewmodelWeapon = e.w;
    recordPrimary(e.w);
    if (!first && performance.now() - (state.localSwitchAt || 0) > 400) sfx.switchWeapon();
  } else if (!state.selfWeaponId) {
    state.selfWeaponId = e.w;
    recordPrimary(e.w);
  } else if (staleWeapon && !!e.zb !== state.self.isZombie) {
    // 僵尸形态变化强制跟随（切枪序号不覆盖变身）
    state.selfWeaponId = e.w;
    rebuildViewmodel(e.w);
    window.__viewmodelWeapon = e.w;
  }
  hud.setSelf(e, state.round, s.alive);
  // 技能按钮（丧尸加速）只在生化模式且自身为丧尸时出现，
  // 判定标准与 hud.setSelf 里的 F 加速指示一致，避免拆弹模式挂着无效按钮。
  state.touchUI?.setSkillVisible?.(state.mode === 'zombie' && !!e.zb);
  // 切枪按钮：丧尸只有尸爪，切枪无意义（localCycleWeapon 对丧尸直接 return），
  // 置灰避免玩家反复点击却毫无反馈。
  state.touchUI?.setSwitchEnabled?.(!e.zb);
  state.touchUI?.setGrenadeEnabled?.(!e.zb && (e.g ?? 0) > 0);
}

// 记住主武器（用于复活/切枪后保持上一把枪）：
// 显式 slot===2 优先；未注册的 id（Mod 武器）也视为主武器
function recordPrimary(id) {
  if (!id) return;
  const def = weaponDef(id);
  if (def ? def.slot === 2 : !['fang', 'k9', 'thunder', 'zclaw'].includes(id)) {
    state.selfPrimaryId = id;
  }
}

// 切换武器：预构建缓存 + 显隐切换，避免每帧同步建模造成卡顿
function rebuildViewmodel(id) {
  const slot = weaponDef(id)?.slot ?? -1;
  // 不同长度的武器需要不同的持握距离：长枪贴着 0.5m 会糊满半个屏幕
  const def0 = weaponDef(id) || {};
  state.vmBaseZ = def0.melee ? -0.44
    : def0.id === 'longshot' ? -0.72
      : def0.slot === 2 ? -0.62
        : def0.id === 'thunder' ? -0.46 : -0.52;
  if (state.vmSlot !== undefined && state.vmSlot !== slot) state.prevVmSlot = state.vmSlot;
  state.vmSlot = slot;
  const key = id || 'k9';
  let vm = state.viewmodels[key];
  if (!vm) {
    vm = buildViewmodel(key);
    renderer.camera.add(vm);
    vm.position.set(0.24, -0.22, -0.5);
    state.viewmodels[key] = vm;
  }
  for (const [k, v] of Object.entries(state.viewmodels)) v.visible = k === key;
  state.viewmodel = vm;
  state.vmKick = 0;
  state.vmSwing = 0;
  state.self.reloadAnim = null; // 换枪打断换弹动画，避免新武器继承换弹姿态
}

// 槽位 → 武器 id（本地乐观切枪用；主武器保留当前快照里的 id，兼容 Mod 替换）
function weaponIdForSlot(slot) {
  if (state.self.isZombie) return slot === 0 ? 'zclaw' : null;
  if (slot === 0) return 'fang';
  if (slot === 1) return 'k9';
  if (slot === 2) {
    const cur = state.selfWeaponId;
    const def = weaponDef(cur);
    if (def && def.slot === 2) return cur;
    // 未知主武器时不要乐观切到一把"想象中的枪"（旧实现兜底 arc17，
    // 拆弹模式刚出生按 2 会先闪出一把步枪再被房主打回手枪）。
    return state.selfPrimaryId;
  }
  if (slot === 3) return 'thunder';
  return null;
}

function slotOfWeapon(id) {
  if (id === 'zclaw') return 0;
  const def = weaponDef(id);
  return def ? def.slot : 2;
}

function localCycleWeapon(dir) {
  // 丧尸只有尸爪，无从可切。旧实现设 pendingSlot=0，随后 weaponIdForSlot(0)
  // 又返回 zclaw（与当前武器相同），applyLocalSwitch 直接 return false —— 死路，
  // 按了永远没反应。这里直接返回，UI 侧同步把切枪键置灰。
  if (state.self.isZombie) return;
  // 只发送循环方向，由房主决定切到哪把枪。
  // 房主才知道玩家真实持有哪些槽位（刚出生只有主武器+手枪），
  // 客户端硬编码 4 槽循环会切到空槽，被 host/room.js 的无效切枪回执打回，
  // 表现为"按了没反应"的闪烁。此处不做本地推测，等房主 switch 回执。
  input.swdQueued = dir > 0 ? 1 : -1;
}

function applyLocalSwitch(slot) {
  if (slot < 0 || slot > 3) return false;
  const w = weaponIdForSlot(slot);
  if (!w || w === state.selfWeaponId) return false;
  state.selfWeaponId = w;
  rebuildViewmodel(w);
  window.__viewmodelWeapon = w;
  state.localSwitchAt = performance.now();
  // 乐观切枪待房主确认窗口：期间忽略旧快照，避免闪回
  state.pendingLocal = { w, at: performance.now() };
  sfx.switchWeapon();
  return true;
}

// ---------------- 本地预测与发送 ----------------
function updateSelf(dt, now) {
  const s = state.self;
  const frame = input.consume();
  if (frame.sw >= 0) {
    state.pendingSlot = null; // 显式切枪优先于未发送的滚轮目标
    applyLocalSwitch(frame.sw);
  }
  // frame.swd 不在此处处理：滚轮与触控切枪都已由 localCycleWeapon 设置
  // （它只把方向交给房主，本地不做乐观切换）。若这里再循环一次，
  // 一次点击会切两把。房主的 switch 回执会更新 selfWeaponId。
  s.crouch = !!frame.c;
  s.yaw = frame.yaw;
  s.pitch = frame.pitch;
  const def = weaponDef(state.selfWeaponId) || BUILTIN_WEAPONS.k9;
  s.weaponMoveMult = def.moveMult || 1;
  if (frame.ads && !s.isZombie && !def.melee && !def.projectile) s.weaponMoveMult *= 0.78;
  if (s.alive && state.map) {
    movePlayer(s, frame, Math.min(dt, 0.05), state.map.colliders, { gravity: state.rules.gravity });
  }
  // 服务器校正量按帧衰减消费：帧率无关（指数衰减），视觉上是一次柔和回拉而非跳变。
  // k=8 为实测最优：把行走时的速度突变从 7.15 m/s 压到 2.15 m/s（降幅约 70%），
  // 同时约 0.4s 内收敛完毕，不会留下可感知的漂移。
  const corr = s.correction;
  if (corr && (corr.x || corr.y || corr.z)) {
    const k = 1 - Math.exp(-Math.min(dt, 0.05) * 8);
    const cx = corr.x * k;
    const cy = corr.y * k;
    const cz = corr.z * k;
    s.pos.x += cx;
    s.pos.y += cy;
    s.pos.z += cz;
    corr.x -= cx;
    corr.y -= cy;
    corr.z -= cz;
    if (Math.abs(corr.x) < 0.0005) corr.x = 0;
    if (Math.abs(corr.y) < 0.0005) corr.y = 0;
    if (Math.abs(corr.z) < 0.0005) corr.z = 0;
  }
  if (now - state.lastInputAt >= 33) {
    const sendFrame = { ...frame, seq: Math.floor(now) };
    if (state.pendingSlot !== null) {
      sendFrame.sw = state.pendingSlot;
      state.pendingSlot = null;
    }
    net.sendInput(sendFrame);
    input.clearEdges();
    state.lastInputAt = now;
  }
  window.__lastFrame = { fire: frame.fire, sw: frame.sw, w: state.selfWeaponId, alive: s.alive, y: +s.pos.y.toFixed(2) };

  // 脚步声
  const moving = s.alive && s.grounded && (frame.mv[0] || frame.mv[1] || frame.mv[2] || frame.mv[3]);
  if (moving && now - state.lastFootstep > (frame.s && frame.mv[0] ? 250 : 380)) {
    sfx.footstep();
    state.lastFootstep = now;
  }
  if (s.isZombie && now - state.lastZombieGrowl > 5200 + Math.random() * 3000) {
    sfx.zombie();
    state.lastZombieGrowl = now;
  }
  return frame;
}

// ---------------- 开镜（ADS）：每把枪独立倍率与准星位姿 ----------------
// 返回 { x,y,z: 开镜时持枪位姿, fov: 开镜FOV, scope: 是否真镜片 }
function adsParams(id) {
  const map = {
    k9:           { x: 0.03, y: -0.17, z: -0.58, fov: 58, scope: false },
    vx9:          { x: 0.04, y: -0.16, z: -0.56, fov: 54, scope: false },
    arc17:        { x: 0.03, y: -0.17, z: -0.56, fov: 52, scope: false },
    warden:       { x: 0.04, y: -0.15, z: -0.56, fov: 56, scope: false },
    longshot:     { x: 0.03, y: -0.16, z: -0.56, fov: 16, scope: true },
    bruiser:      { x: 0.03, y: -0.16, z: -0.56, fov: 54, scope: false },
    energy_rifle: { x: 0.03, y: -0.17, z: -0.56, fov: 52, scope: false },
    cryo_gun:     { x: 0.03, y: -0.16, z: -0.56, fov: 54, scope: false },
    railgun:      { x: 0.03, y: -0.16, z: -0.56, fov: 22, scope: true },
  };
  return map[id] || null;
}

// 真镜片遮罩：全屏黑色 + 中心圆形镜片（透明让 3D 透出）+ 十字/密位
function ensureScopeOverlay() {
  if (state.scopeCanvas) return;
  const c = document.createElement('canvas');
  c.id = 'scope-canvas';
  c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:9;pointer-events:none;display:none;';
  document.getElementById('app').appendChild(c);
  state.scopeCanvas = c;
}

function drawScopeOverlay() {
  const c = state.scopeCanvas;
  if (!c) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = innerWidth;
  const H = innerHeight;
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
  }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const cx = W / 2;
  const cy = H / 2;
  const radius = Math.min(W, H) * 0.26;
  // 圆形镜片：清空中心让 3D 透出
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  // 镜片边缘
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  // 十字线（密位）
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx - radius * 0.94, cy);
  ctx.lineTo(cx + radius * 0.94, cy);
  ctx.moveTo(cx, cy - radius * 0.94);
  ctx.lineTo(cx, cy + radius * 0.94);
  ctx.stroke();
  // 圆周密位刻度
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 1.2;
  for (let a = 0; a < 360; a += 45) {
    const r1 = radius * 0.78;
    const r2 = radius * 0.94;
    const x1 = cx + Math.cos((a * Math.PI) / 180) * r1;
    const y1 = cy + Math.sin((a * Math.PI) / 180) * r1;
    const x2 = cx + Math.cos((a * Math.PI) / 180) * r2;
    const y2 = cy + Math.sin((a * Math.PI) / 180) * r2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  // 中心点
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
  ctx.fill();
}

function updateScopeOverlay(visible, opacity) {
  if (!state.scopeCanvas) {
    if (visible) ensureScopeOverlay();
    else return;
  }
  const c = state.scopeCanvas;
  c.style.display = visible ? '' : 'none';
  if (!visible) return;
  c.style.opacity = String(Math.max(0, Math.min(1, opacity)));
  // 仅在视口尺寸变化时重绘（镜片画面本身是静态的）
  if (c.dataset.w !== String(innerWidth) || c.dataset.h !== String(innerHeight)) {
    c.dataset.w = String(innerWidth);
    c.dataset.h = String(innerHeight);
    drawScopeOverlay();
  }
}

// ---------------- 视角与第一人称 ----------------
function updateCamera(dt, frame) {
  const cam = renderer.camera;
  const s = state.self;
  cam.position.set(s.pos.x, s.pos.y + (s.crouch ? 1.05 : 1.62), s.pos.z);
  const ap = frame.ads && !s.isZombie && s.alive ? adsParams(state.selfWeaponId) : null;
  // 开镜参数在关镜回退期间保留，确保枪模型/倍率/镜片都能平滑退回腰射（补出关镜动画）
  if (ap) state.activeAds = ap;
  const active = state.activeAds;
  const targetAds = ap ? 1 : 0;
  state.adsAmount += (targetAds - state.adsAmount) * Math.min(1, dt * (active && active.scope ? 7 : 11));
  if (Math.abs(state.adsAmount) < 0.002 && targetAds === 0) {
    state.adsAmount = 0;
    state.activeAds = null;
  }
  const t = state.adsAmount;
  // 倍率：从基础 FOV 平滑过渡到开镜 FOV
  const targetFov = active ? active.fov : settings.fov;
  cam.fov = lerp(settings.fov, targetFov, t);
  cam.updateProjectionMatrix();
  cam.rotation.order = 'YXZ';
  cam.rotation.y = s.yaw;
  cam.rotation.x = s.pitch;

  // 真镜片遮罩（狙击/磁轨）
  const scoped = !!(s.alive && active && active.scope && t > 0.35);
  updateScopeOverlay(scoped, (t - 0.35) / 0.65);

  if (state.viewmodel) {
    const vm = state.viewmodel;
    state.vmKick = Math.max(0, state.vmKick - dt * 5);
    // 挥砍动画时长与武器射速对齐（匕首 170RPM≈0.35s，尸爪 72RPM≈0.83s），
    // 这样"挥完即到下一次可攻击"，动作与手感一致而不是各有各的节奏。
    const swingDef = weaponDef(state.selfWeaponId) || {};
    const swingDur = swingDef.melee ? Math.max(0.18, 60 / Math.max(1, swingDef.fireRate)) : 0.25;
    state.vmSwing = Math.max(0, state.vmSwing - dt / swingDur);
    updateViewmodelAnim(s, vm, dt, t, active, scoped, frame);
  }
}

// ---------------- 第一人称武器动画 ----------------
// 移动摆动相位由实际水平位移驱动（而非 wall-clock），这样"走着抖"在停下来时
// 会自然归零，也不会因为帧率/时间漂移产生跳变。
function updateViewmodelAnim(s, vm, dt, adsT, active, scoped, frame) {
  const id = state.selfWeaponId;
  const def = weaponDef(id) || {};
  const isMelee = !!def.melee;
  const movingNow = moving();

  // ---- 移动摆动（bob）：按位移累积相位 ----
  const speed = Math.hypot(s.vel.x, s.vel.z);
  if (movingNow && speed > 0.25) {
    state.bobPhase = (state.bobPhase || 0) + dt * (6.2 + speed * 1.15);
  } else {
    // 停步时相位平滑收敛到最近的正中，避免摆动突然定在极限位置
    const target = Math.round((state.bobPhase || 0) / Math.PI) * Math.PI;
    state.bobPhase = (state.bobPhase || 0) + (target - (state.bobPhase || 0)) * Math.min(1, dt * 9);
  }
  const ph = state.bobPhase || 0;
  const amp = movingNow ? Math.min(1, speed / 5.5) * (1 - adsT * 0.72) : 0;
  const bobX = Math.sin(ph) * 0.011 * amp;
  const bobY = -Math.abs(Math.cos(ph)) * 0.013 * amp;
  const bobRoll = Math.sin(ph) * 0.028 * amp;

  // ---- 近战挥砍：以 0..1 的挥砍进度驱动多段曲线 ----
  // 前 30% 抬手蓄力，随后快速下劈，尾部回位。匕首与尸爪节奏不同。
  let swingPose = null;
  if (state.vmSwing > 0 && isMelee) {
    const isClaw = id === 'zclaw';
    // vmSwing 从 1 线性衰减到 0；映射为 0(起手)→1(收招)
    const p = 1 - state.vmSwing;
    const windup = isClaw ? 0.34 : 0.28;   // 蓄力占比
    const clawArc = isClaw ? 1.15 : 0.85;  // 挥砍幅度：尸爪更狠
    if (p < windup) {
      // 蓄力：向后上方抬起
      const k = easeOutCubic(p / windup);
      swingPose = {
        px: k * (isClaw ? 0.10 : 0.07),
        py: k * (isClaw ? 0.16 : 0.12),
        pz: k * 0.11,
        rx: -k * (isClaw ? 0.55 : 0.42),
        ry: k * (isClaw ? 0.22 : 0.16),
        rz: 0,
      };
    } else {
      // 下劈再回位
      const k = (p - windup) / (1 - windup);
      const strike = Math.sin(Math.min(1, k * 1.9) * Math.PI);
      const settle = easeOutCubic(Math.max(0, k - 0.5) * 2);
      const w = 1 - settle;
      swingPose = {
        px: (isClaw ? 0.10 : 0.07) * w - strike * (isClaw ? 0.20 : 0.15),
        py: (isClaw ? 0.16 : 0.12) * w - strike * (isClaw ? 0.26 : 0.19),
        pz: 0.11 * w - strike * (isClaw ? 0.30 : 0.24),
        rx: -(isClaw ? 0.55 : 0.42) * w + strike * clawArc,
        ry: (isClaw ? 0.22 : 0.16) * w - strike * (isClaw ? 0.36 : 0.26),
        rz: strike * (isClaw ? -0.22 : -0.15),
      };
    }
  }

  // ---- 换弹动画 ----
  let reloadPose = null;
  const rl = s.reloadAnim;
  if (rl && rl.t < rl.dur) {
    rl.t += dt;
    const p = Math.min(1, rl.t / rl.dur);
    // 三段：前 35% 落枪/压下，35%~70% 换弹（下沉旋转），70%~100% 复位上抬
    const down = p < 0.35 ? easeOutCubic(p / 0.35)
      : p < 0.7 ? 1
      : 1 - easeOutCubic((p - 0.7) / 0.3);
    const shake = p > 0.3 && p < 0.78 ? Math.sin(p * 46) * (1 - Math.abs(p - 0.54) / 0.24) : 0;
    reloadPose = {
      px: -0.06 * down,
      py: -0.20 * down + shake * 0.012,
      pz: 0.10 * down,
      rx: 0.62 * down,
      ry: -0.30 * down,
      rz: 0.26 * down + shake * 0.05,
    };
    if (rl.t >= rl.dur) s.reloadAnim = null;
  }

  // ---- 合成位姿：基础 + 开镜插值 ----
  const baseX = 0.24 + Math.sin(ph * 0.5) * 0.006;
  const baseY = -0.22;
  const baseZ = state.vmBaseZ ?? -0.5;
  let nX = baseX + bobX + state.vmKick * 0.006;
  let nY = baseY + bobY - state.vmKick * 0.04;
  let nZ = baseZ + state.vmKick * 0.12;
  let rotX = state.vmKick * 0.1;
  let rotY = 0;
  let rotZ = bobRoll;

  if (swingPose) {
    // 近战挥砍幅度不受开镜插值影响（近战不参与开镜）
    nX += swingPose.px;
    nY += swingPose.py;
    nZ += swingPose.pz;
    rotX += swingPose.rx;
    rotY += swingPose.ry;
    rotZ += swingPose.rz;
  }
  if (reloadPose) {
    nX += reloadPose.px;
    nY += reloadPose.py;
    nZ += reloadPose.pz;
    rotX += reloadPose.rx;
    rotY += reloadPose.ry;
    rotZ += reloadPose.rz;
  }

  const aX = active ? active.x : nX;
  const aY = active ? active.y : nY;
  const aZ = active ? active.z : nZ;
  if (scoped) {
    vm.visible = false;
  } else {
    vm.visible = s.alive;
    vm.position.set(nX + (aX - nX) * adsT, nY + (aY - nY) * adsT, nZ + (aZ - nZ) * adsT);
    vm.rotation.x = rotX * (1 - adsT);
    vm.rotation.y = rotY * (1 - adsT);
    vm.rotation.z = rotZ * (1 - adsT);
  }
}

function easeOutCubic(x) {
  const t = Math.max(0, Math.min(1, x));
  return 1 - Math.pow(1 - t, 3);
}

function moving() {
  const s = state.self;
  return s.alive && s.grounded && (s.vel.x ** 2 + s.vel.z ** 2) > 0.4;
}

function updateRemotePlayers(dt, now) {
  for (const rec of state.players.values()) {
    const mesh = rec.mesh;
    const parts = mesh.userData.parts;

    // ---- 倒地：向后塌倒 → 停留 → 隐藏（比瞬间消失清楚得多）----
    if (rec.death) {
      rec.death.t += dt;
      const k = Math.min(1, rec.death.t / rec.death.dur);
      const e = easeOutCubic(k);
      mesh.rotation.x = -1.45 * e;
      mesh.position.y = (rec.death.baseY ?? rec.next.y) - 0.06 * e;
      mesh.visible = true;
      if (k >= 1) {
        rec.death.hold = (rec.death.hold || 0) + dt;
        if (rec.death.hold > 1.1) {
          mesh.visible = false;
          rec.death = null;
        }
      }
      if (rec.tag) rec.tag.visible = false;
      continue;
    }
    if (!rec.next.al) {
      mesh.visible = false;
      if (rec.tag) rec.tag.visible = false;
      continue;
    }

    // ---- 位置 / 朝向插值（50ms 缓冲 + 100ms 窗口）----
    const t = clamp((now - rec.t0 - 50) / 100, 0, 1);
    const a = rec.last;
    const b = rec.next;
    const speed = rec.speed || 0;
    const moving = speed > 0.5;
    const amp = Math.min(1, speed / 5);
    // 步频跟着实际速度走；停下来时相位继续缓慢推进，保留轻微呼吸感
    rec.phase += dt * (moving ? 4.6 + speed * 0.9 : 1.5);
    const swing = Math.sin(rec.phase) * 0.62 * amp;
    const bob = moving ? Math.abs(Math.sin(rec.phase)) * 0.05 * amp : Math.sin(rec.phase * 0.8) * 0.008;
    mesh.position.set(lerp(a.x, b.x, t), lerp(a.y, b.y, t) + bob, lerp(a.z, b.z, t));
    mesh.rotation.y = angLerp(a.ya, b.ya, t);
    // 受击/开火后仰（0.25 → 0 衰减）
    if (rec.flinch > 0) rec.flinch = Math.max(0, rec.flinch - dt * 4);
    mesh.rotation.x = -0.16 * rec.flinch;
    mesh.visible = true;

    // 蹲下：整体压到 0.68 高（脚底仍贴地），同时把名牌放低
    const crouch = rec.crouch ? 1 : 0;
    const targetSy = crouch ? 0.68 : 1;
    mesh.scale.y += (targetSy - mesh.scale.y) * Math.min(1, dt * 14);

    if (parts) {
      if (rec.zombie) {
        // 丧尸：双臂前伸、随步伐左右晃、躯干含胸
        const s = Math.sin(rec.phase) * (0.18 + 0.12 * amp);
        parts.armL.rotation.x = -1.15 + s * 0.6;
        parts.armR.rotation.x = -1.2 - s * 0.6;
        parts.legL.rotation.x = swing * 0.85;
        parts.legR.rotation.x = -swing * 0.85;
        parts.torso.rotation.x = 0.16 + 0.06 * amp;
      } else {
        // 人类：双手持枪，手臂只做呼吸微动，靠腿和躯干表现走姿
        parts.armL.rotation.x = -1.34 + Math.sin(rec.phase * 2) * 0.025 * amp;
        parts.armR.rotation.x = -1.28 - Math.sin(rec.phase * 2) * 0.025 * amp;
        parts.legL.rotation.x = swing;
        parts.legR.rotation.x = -swing;
        parts.torso.rotation.x = 0.02 + 0.05 * amp;
      }
      if (crouch) {
        parts.legL.rotation.x = -0.95;
        parts.legR.rotation.x = -0.55;
      }
      // 头部俯仰跟随快照里的 pitch：远处也能看出对手在瞄高还是瞄低
      parts.head.rotation.x = clamp(-rec.pitch * 0.6, -0.7, 0.7) + (rec.zombie ? 0.12 : 0);
    }

    if (rec.tag) {
      rec.tag.position.set(mesh.position.x, mesh.position.y + (crouch ? 2.05 : 2.42), mesh.position.z);
      rec.tag.visible = true;
    }
  }
}

function updateCrosshair(dt, frame) {
  const s = state.self;
  const ap = frame.ads && !s.isZombie && s.alive ? adsParams(state.selfWeaponId) : state.activeAds;
  const el = document.getElementById('crosshair');
  const scoped = !!(ap && ap.scope && state.adsAmount > 0.35);
  el.style.display = scoped ? 'none' : '';
  let spread = 10;
  const def = weaponDef(state.selfWeaponId) || {};
  // 开镜时准星收拢（瞄准状态，命中更准）
  const adsT = state.adsAmount;
  if (ap && !def.melee && !def.projectile && !s.isZombie) spread = lerp(10, 3, adsT);
  if (frame.fire) spread += def.recoil ? def.recoil * 900 : 8;
  if (moving() && s.grounded) spread += 6 * (1 - adsT);
  if (!s.grounded) spread += 8 * (1 - adsT);
  const gap = Math.round(spread);
  const lines = el.querySelectorAll('.ch-line');
  if (lines.length === 4) {
    lines[0].style.height = `${12 + gap}px`;
    lines[1].style.height = `${12 + gap}px`;
    lines[2].style.width = `${12 + gap}px`;
    lines[3].style.width = `${12 + gap}px`;
  }
  // 弹匣见底：准星转为琥珀色提示，比等打空了才听到空仓声更早
  const magSize = def.magSize || 0;
  const low = !def.melee && !s.isZombie && magSize > 1 && (state.self.ammo ?? 0) <= Math.ceil(magSize * 0.25);
  el.classList.toggle('low-ammo', !!low);
}

// Q：切回上一把武器（桌面端最常见的操作习惯）
function quickSwap() {
  const prev = state.prevVmSlot;
  if (prev === undefined || prev < 0 || prev === state.vmSlot) return;
  if (!weaponIdForSlot(prev)) return;
  applyLocalSwitch(prev);
}

// 移动端"雷"键：切到投掷物并立即按一次开火（服务器判定剩余数量）
function throwGrenadeQuick() {
  if (!state.self.alive || state.self.isZombie) return;
  if ((state.self.grenades ?? 0) <= 0) {
    hud.toast('没有手雷了');
    sfx.empty();
    return;
  }
  applyLocalSwitch(3);
  setTimeout(() => {
    input.fire = true;
    setTimeout(() => { input.fire = false; }, 90);
  }, 130);
}

function fireVisuals(frame) {
  const def = weaponDef(state.selfWeaponId) || {};
  const held = !!frame.fire;
  const press = shouldFire(def, held, !!state.wasFiring);
  state.wasFiring = held;
  if (!press || !state.self.alive) return;
  if ((state.self.ammo ?? 0) <= 0 && !state.self.isZombie) {
    const now = performance.now();
    if (now - (state.emptyAt || 0) > 260) {
      state.emptyAt = now;
      sfx.empty();
    }
    return;
  }
  if (def.projectile === 'grenade') {
    if (performance.now() - (state.lastThrowAt || 0) > 300) {
      state.lastThrowAt = performance.now();
      // 投掷：抬手投出的动画 + 投掷音效（手雷不产生枪口焰）
      state.vmSwing = 1;
      state.throwAnimAt = performance.now();
      sfx.throw();
    }
    return;
  }
  if (def.melee) {
    if (performance.now() - (state.lastMeleeAt || 0) > 240) {
      state.lastMeleeAt = performance.now();
      // 近战挥砍：只触发挥砍动画与挥砍音效，不产生枪口焰（近战没有枪口）
      state.vmSwing = 1;
      sfx.shot('melee');
      const dir = directionFromAngles(state.self.yaw, state.self.pitch);
      const from = { x: state.self.pos.x, y: state.self.pos.y + 1.6, z: state.self.pos.z };
      const to = { x: from.x + dir.x * 2.2, y: from.y + dir.y * 2.2, z: from.z + dir.z * 2.2 };
      // 挥砍轨迹：用短促的弧形划痕代替直线弹道，更贴合刀具
      effects.slash(from, to, state.selfWeaponId === 'zclaw');
    }
    return;
  }
  const interval = 60000 / Math.max(1, def.fireRate);
  const now = performance.now();
  if (now - (state.lastShotAt || 0) < interval) return;
  state.lastShotAt = now;
  state.vmKick = 1;
  sfx.shot(def.sound || 'rifle');
  const scoped = !!(state.adsAmount > 0.35 && adsParams(state.selfWeaponId)?.scope);
  if (state.viewmodel?.userData.muzzle && !scoped) {
    effects.muzzle(state.viewmodel.userData.muzzle);
  }
  // 弹道（客户端视觉）：开镜用 adsSpread，与服务器命中分布一致 → 瞄哪打哪
  const dir = directionFromAngles(state.self.yaw, state.self.pitch);
  const from = { x: state.self.pos.x, y: state.self.pos.y + 1.62, z: state.self.pos.z };
  const spread = frame.ads ? (def.adsSpread ?? def.spread ?? 0.01) : (def.spread ?? 0.02);
  const dir2 = directionFromAngles(
    state.self.yaw + (Math.random() - 0.5) * spread * 2,
    state.self.pitch + (Math.random() - 0.5) * spread * 2
  );
  let maxT = 120;
  for (const box of state.map.colliders) {
    const t = rayAABB(from, dir2, box.min, box.max);
    if (t < maxT) maxT = t;
  }
  const to = { x: from.x + dir2.x * maxT, y: from.y + dir2.y * maxT, z: from.z + dir2.z * maxT };
  effects.tracer(from, to);
  // 打到实体（不是打到天空）：留弹孔 + 一小片灰尘，让"打在墙上"有落点反馈
  if (maxT < 118) {
    effects.decal(to, dir2);
    if (Math.random() < 0.5) effects.impact(to, 'dust');
  }
  if (state.viewmodel?.userData.muzzle && !scoped) {
    const muzzleWorld = state.viewmodel.userData.muzzle.getWorldPosition(new THREE.Vector3());
    effects.shell({ x: muzzleWorld.x, y: muzzleWorld.y - 0.05, z: muzzleWorld.z }, { x: -dir.x, y: 0.5, z: -dir.z });
  }
}

// ---------------- 主循环 ----------------
let lastFrame = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (!state.inGame || state.paused) {
    renderer.render();
    return;
  }
  const frame = updateSelf(dt, now);
  // 开镜灵敏度：按倍率缩放（放大越多越慢，便于精细瞄准）
  if (!state.self.isZombie && state.self.alive) {
    const ap = adsParams(state.selfWeaponId);
    if (ap && state.adsAmount > 0.001) {
      const zoom = settings.fov / ap.fov;
      const scale = Math.max(0.12, 1 / (zoom * 0.85));
      input.sensitivity = settings.sens * (scale + (1 - scale) * (1 - state.adsAmount));
    } else {
      input.sensitivity = settings.sens;
    }
  } else {
    input.sensitivity = settings.sens;
  }
  // 触控视角复用同一结果（见 setupTouch 回调），确保开镜降速对触屏同样生效
  input.effectiveSens = input.sensitivity;
  if (state.wasGrounded === false && state.self.grounded) {
    sfx.land();
    effects.impact({ x: state.self.pos.x, y: state.self.pos.y + 0.06, z: state.self.pos.z }, 'dust');
  }
  if (state.wasGrounded === true && !state.self.grounded) sfx.jump();
  state.wasGrounded = state.self.grounded;
  if (now - state.lastPingAt > 2000) {
    state.lastPingAt = now;
    net.ping();
  }
  fireVisuals(frame);
  updateCamera(dt, frame);
  // 听者跟随相机：空间化音效靠它算距离与左右声像
  sfx.updateListener(renderer.camera);
  updateCrosshair(dt, frame);

  // 其他玩家：位置插值 + 第三人称动画（行走/呼吸/下蹲/丧尸蹒跚/倒地）
  updateRemotePlayers(dt, now);

  // 炸弹灯闪烁（仅已安放时）
  if (state.bombMesh?.userData.light && state.bombMesh.userData.planted) {
    state.bombMesh.userData.blink += dt;
    state.bombMesh.userData.light.material.emissiveIntensity = 1.5 + Math.sin(state.bombMesh.userData.blink * 8) * 1.2;
  }

  // 记分板 / 暂停
  const sb = input.scoreboard && state.connected;
  if (sb !== state.sbShown) {
    state.sbShown = sb;
    hud.showScoreboard(sb, state.snap?.p || [], state.selfId);
  } else if (state.sbShown && now - state.lastSbRenderAt > 500) {
    state.lastSbRenderAt = now; // 打开期间定期刷新（击杀/死亡/得分实时更新）
    hud.showScoreboard(true, state.snap?.p || [], state.selfId);
  }
  hud.setRound(state.round);
  hud.setStatus(net.connected);
  // FPS：每 0.5s 结算一次，避免每帧改 DOM
  state.frames = (state.frames || 0) + 1;
  state.fpsT = (state.fpsT || 0) + dt;
  if (state.fpsT >= 0.5) {
    state.fps = Math.round(state.frames / state.fpsT);
    state.frames = 0;
    state.fpsT = 0;
    if (settings.fps) hud.setFps(state.fps, net.isHost);
  }
  if (state.buyOpen && now - state.lastBuyRenderAt > 250) {
    state.lastBuyRenderAt = now;
    renderBuyUI();
  }

  effects.update(dt);
  renderer.render();
}

// ---------------- 聊天 / 指针锁定 ----------------
// 客户端 Mod 的按键绑定（例如 F8 切换自绘 HUD）
function bindModKeys() {
  window.addEventListener('keydown', (e) => {
    if (!state.inGame || hud.chatOpen) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    for (const m of state.mods || []) {
      const fn = m.keys && m.keys.get(e.code);
      if (fn) {
        try {
          fn(e);
        } catch (err) {
          console.error(`[mod:${m.meta.id}] key handler error`, err);
        }
      }
    }
  });
}

function bindChatKey() {
  window.addEventListener('keydown', (e) => {
    if (!state.inGame) return;
    if (e.code === 'KeyB' && !hud.chatOpen) {
      e.preventDefault();
      toggleBuy();
      return;
    }
    if (e.key === 'Escape' && state.buyOpen) {
      closeBuy();
      return;
    }
    // “=”：切换暂停菜单（火狐按 Esc 只释放鼠标、不弹菜单，用 = 作为可靠入口）
    if ((e.key === '=' || e.code === 'Equal') && !hud.chatOpen && !state.buyOpen) {
      e.preventDefault();
      togglePause();
      return;
    }
    if (e.key === 'Enter' && !hud.chatOpen) {
      // 关闭聊天（Enter 发送 / Escape 取消）时统一重置输入态并重新锁定指针
      hud.openChat(
        (text) => net.chat(text),
        () => {
          input.chatOpen = false;
          input.requestLock();
        }
      );
      document.exitPointerLock();
      input.chatOpen = true;
      e.preventDefault();
    }
    if (e.key === 'Escape' && hud.chatOpen) {
      hud.closeChat();
    }
  });
}

function bindPointer() {
  document.addEventListener('pointerlockchange', () => {
    if (!state.inGame) return;
    const locked = document.pointerLockElement === canvas;
    input.locked = locked;
    // 按住 Alt 释放鼠标时不弹出暂停菜单
    if (input.altFree) {
      setPaused(false);
      return;
    }
    setPaused(!locked && !hud.chatOpen && !state.buyOpen && !$('settings').classList.contains('hidden'));
    if (state.paused) sfx.click();
  });
  canvas.addEventListener('click', () => {
    if (!state.inGame) return;
    if (state.paused) setPaused(false);
    if (!input.altFree && !hud.chatOpen) input.requestLock();
  });
  // 暂停面板：点击任意位置恢复（此前被触控层遮挡，桌面/移动端都无法“点击画面继续”）
  $('paused').addEventListener('click', () => {
    if (!state.inGame || !state.paused) return;
    setPaused(false);
    if (!hud.chatOpen) input.requestLock();
  });
  $('leave-room-btn').addEventListener('click', (e) => e.stopPropagation());
}

// 按住 Alt 在游戏内释放鼠标（光标可点击 ☰ 菜单 / 退出房间），松开自动重新锁定。
// 火狐等浏览器按 Esc 只释放鼠标、不一定触发暂停菜单，Alt 是可靠的鼠标释放入口。
let altHeld = false;
function bindAltFree() {
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'Alt' && !e.ctrlKey && state.inGame && !altHeld) {
      altHeld = true;
      input.altFree = true;
      document.exitPointerLock();
      setPaused(false);
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Alt') {
      altHeld = false;
      input.altFree = false;
      if (state.inGame && !state.paused && !hud.chatOpen && !state.buyOpen) {
        input.requestLock();
      }
    }
  });
}

function toggleBuy() {
  if (state.buyOpen) {
    closeBuy();
    return;
  }
  // 丧尸不能选枪；死斗/军备竞赛没有商店
  if (state.mode === 'zombie' && state.self.isZombie) {
    hud.toast('丧尸不能选枪');
    sfx.click();
    return;
  }
  if (state.mode === 'tdm' || state.mode === 'gungame') {
    hud.toast('该模式没有商店，武器随复活/升级自动发放');
    sfx.click();
    return;
  }
  state.buyOpen = true;
  renderBuyUI();
  document.exitPointerLock();
}

// 统一渲染购买/选枪界面：生化=选枪目录（含 Mod 主武器），拆弹=原购买菜单。
// 主循环每 250ms 调用一次以刷新金钱，因此必须按模式分支，避免互相覆盖。
function renderBuyUI() {
  if (state.mode === 'zombie') {
    const equipped = (state.selfWeaponId && state.zombieCatalog.some((it) => it.id === state.selfWeaponId))
      ? state.selfWeaponId
      : state.zombieEquippedId;
    hud.showZombieMenu(
      { money: state.self.money ?? 0, items: state.zombieCatalog, equippedId: equipped, armor: state.self.armor ?? 0 },
      (item) => {
        net.send({ type: 'zselect', item });
        closeBuy();
      },
      () => closeBuy()
    );
  } else {
    hud.showBuyMenu(
      { money: state.self.money ?? 0, phase: state.round?.ph, remaining: state.round?.bu ?? 0, boughtItems: state.self.boughtItems || [] },
      (item) => {
        net.send({ type: 'buy', item });
        closeBuy();
      },
      (item) => {
        net.send({ type: 'refund', item });
      },
      () => closeBuy()
    );
  }
}

function closeBuy() {
  state.buyOpen = false;
  hud.hideBuyMenu();
  if (!hud.chatOpen) input.requestLock();
}

function rebuildMap(msg) {
  if (state.mapGroup) renderer.scene.remove(state.mapGroup);
  state.map = MAPS[msg.map] || state.map;
  // 天空/雾/光照都是按地图配置的，换图必须一起换，否则会沿用上一张图的氛围
  renderer.setupSky(state.map.sky);
  renderer.setupLights(state.map);
  state.mapGroup = buildMapMesh(state.map);
  renderer.scene.add(state.mapGroup);
  if (state.bombMesh) {
    renderer.scene.remove(state.bombMesh);
    state.bombMesh = null;
  }
  for (const [id, m] of state.grenadeMeshes) {
    renderer.scene.remove(m);
    state.grenadeMeshes.delete(id);
  }
  hud.toast(`地图切换：${msg.mapName}`);
}

// ---------------- 启动 ----------------
window.__input = input;
window.__cycleWeapon = localCycleWeapon;
window.__testUpdateSelf = updateSelf;
window.__slotOf = slotOfWeapon;
window.__gameState = () => ({ inGame: state.inGame, selfId: state.selfId, connected: state.connected, mode: state.mode, netHost: net.isHost });
window.__zombieCatalog = () => state.zombieCatalog;
// 房主侧诊断：回合/阶段/模拟时间/存活数（离线排查计时与出生问题用）
window.__roomState = () => {
  const r = net.host?.room;
  if (!r) return null;
  return {
    time: +r.time.toFixed(2), phase: r.phase, round: r.roundNum, paused: !!r.paused,
    alive: [...r.players.values()].filter((p) => p.alive).length,
    me: (() => { const p = r.players.get(state.selfId); return p ? { alive: p.alive, y: +p.pos.y.toFixed(2), team: p.team, hp: p.hp } : null; })(),
  };
};
window.__selfIsZombie = () => !!state.self.isZombie;
window.__selfWeaponId = () => state.selfWeaponId;
window.__selfMoney = () => state.self.money ?? 0;
window.__zombieEquippedId = () => state.zombieEquippedId;
window.__weaponDef = (id) => {
  const d = weaponDef(id);
  return d ? { name: d.name, slot: d.slot, fireRate: d.fireRate, auto: !!d.auto, sound: d.sound } : null;
};
// 开发用：直接切图（含服务端碰撞与出生点同步），方便逐图检查美术与 Bot 寻路
window.__debugMap = (id) => {
  const r = net.host?.room;
  if (!r || !MAPS[id]) return false;
  r.mapId = id;
  r.map = MAPS[id];
  r.ammoBoxes = (r.map.ammoBoxes || []).map((b) => ({ ...b, available: true, respawnAt: 0 }));
  r.healthBoxes = (r.map.healthBoxes || []).map((b) => ({ ...b, available: true, respawnAt: 0 }));
  r.spawnAll();
  rebuildMap({ map: id, mapName: MAPS[id].name });
  return true;
};
window.__sceneChildren = () => renderer.scene.children.length;
window.__debugRender = () => ({
  env: !!renderer.scene.environment,
  envType: renderer.scene.environment?.mapping ?? null,
  envIntensity: renderer.scene.environmentIntensity,
  vm: state.viewmodel ? state.viewmodel.children.filter((c) => c.isMesh).map((c) => ({
    color: c.material.color.getHexString(),
    metalness: c.material.metalness,
    roughness: c.material.roughness,
    hasEnv: !!c.material.envMap,
    visible: c.visible,
  })) : null,
  lights: renderer.scene.children.filter((c) => c.isLight).map((l) => [l.type, l.intensity]),
  cam: [+renderer.camera.position.x.toFixed(2), +renderer.camera.position.y.toFixed(2), +renderer.camera.position.z.toFixed(2)],
  mapChildren: state.mapGroup ? state.mapGroup.children.length : -1,
  mapId: state.map && state.map.id,
  fogNear: renderer.scene.fog && renderer.scene.fog.near,
  selfPos: [+state.self.pos.x.toFixed(2), +state.self.pos.y.toFixed(2), +state.self.pos.z.toFixed(2)],
  bg: renderer.scene.background && renderer.scene.background.getHexString && renderer.scene.background.getHexString(),
});
window.__fpsProbe = () => { let frames = 0; const t0 = performance.now(); return new Promise((res) => { function tick() { frames++; if (performance.now() - t0 >= 2000) res(frames / 2); else requestAnimationFrame(tick); } requestAnimationFrame(tick); }); };

function boot() {
  bindSettingsUI();
  wireEvents();
  bindChatKey();
  bindModKeys();
  bindPointer();
  bindAltFree();
  bindAuthUI();
  // 浏览器自动播放策略：首次手势后自动开始背景音乐（默认开，可在设置关闭）
  function autoplayMusic() {
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.removeEventListener(ev, autoplayMusic);
    if (settings.music) music.start();
  }
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, autoplayMusic);
  $('connect-btn').onclick = () => {
    sfx.resume();
    sfx.click();
    connect();
  };
  $('offline-btn').onclick = () => {
    sfx.resume();
    sfx.click();
    connectOffline();
  };
  $('leave-room-btn').onclick = () => {
    sfx.click();
    leaveRoom();
  };
  $('pause-btn').onclick = () => openPauseMenu();
  // 暂停面板里进设置：不能冒泡到 #paused 的"点击继续"，否则一进设置就自动解除暂停
  $('pause-settings-btn').onclick = (e) => {
    e.stopPropagation();
    sfx.click();
    $('paused').classList.add('hidden');
    $('menu').classList.add('hidden');
    $('settings').classList.remove('hidden');
  };
  // 菜单 Mod 列表：读取静态清单（浏览器无 /api/mods 接口；用 import.meta.url 定位，避免 ../ 解析到 /mods）
  fetch(new URL('../mods/manifest.json', import.meta.url))
    .then((r) => r.json())
    .then((list) => {
      const chips = [];
      for (const m of [...(list.server || []), ...(list.client || [])]) {
        chips.push(`<span class="mod-chip" title="">${m.name} v${m.version}</span>`);
      }
      $('menu-mods').innerHTML = chips.join('') || '<span class="mod-chip">内置 8 种武器</span>';
    })
    .catch(() => {
      $('menu-mods').innerHTML = '<span class="mod-chip">内置 8 种武器</span>';
    });
  window.addEventListener('beforeunload', () => net.leave());
  applySettings();
  renderer.render();
  requestAnimationFrame(loop);
}

boot();
