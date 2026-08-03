// 主循环（VibeHub 版）：登录、加入房间、本地预测、插值渲染、事件接线、菜单/设置。
// 同步模型：state-sync（房主权威）。房主本 tab 跑 30Hz 权威模拟并广播 20Hz 快照，
// 所有客户端（含房主本人）走同一套状态/事件消息渲染。

import * as THREE from 'three';
import { Net } from './net.js';
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
import { MODE_LABEL, PHYS } from '../shared/constants.js';
import { BUILTIN_WEAPONS, shouldFire } from '../shared/weapons.js';
import { movePlayer } from '../shared/physics.js';
import { rayAABB, directionFromAngles, distance, angLerp, lerp, clamp } from '../shared/math.js';
import { registerModWeapons, weaponDef } from './weapon-registry.js';

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

const defaultSettings = { sens: 1, fov: 75, vol: 0.8, music: true, shadow: true, quality: 'high' };
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
  selfPrimaryId: 'arc17',
  lastSwitchSeq: 0,
  pendingLocal: null,
  zombieCatalog: [], // 生化模式选枪目录（含 Mod 主武器）
  zombieEquippedId: null,
  adsAmount: 0,       // 0=腰射，1=完全开镜（平滑过渡）
  scopeCanvas: null,
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
  sfx.setVolume(settings.vol);
  renderer.applySettings({ shadow: settings.shadow, quality: settings.quality });
}

function bindSettingsUI() {
  $('set-sens').value = settings.sens;
  $('set-fov').value = settings.fov;
  $('set-vol').value = Math.round(settings.vol * 100);
  $('set-music').value = settings.music ? '1' : '0';
  $('set-shadow').value = settings.shadow ? '1' : '0';
  $('set-quality').value = settings.quality;
  $('set-sens').oninput = (e) => { settings.sens = +e.target.value; saveSettings(); applySettings(); };
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
  $('settings-close').onclick = () => {
    $('settings').classList.add('hidden');
    $('menu').classList.remove('hidden');
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

function enterGame(welcome) {
  if (state.connected) return; // 重复 welcome（房主重发握手）时忽略
  state.connected = true;
  net.connected = true;
  state.selfId = welcome.id;
  state.selfName = $('name-input').value.trim() || '战士';
  hud.selfId = welcome.id;
  state.mode = welcome.mode;
  state.map = MAPS[welcome.map] || MAPS.vertex;
  hud.setMode(welcome.mode, welcome.modeLabel);
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

  renderer.setupSky(state.map.sky);
  renderer.setupLights();
  applySettings();
  state.mapGroup = buildMapMesh(state.map);
  renderer.scene.add(state.mapGroup);
  rebuildViewmodel('k9');
  renderer.scene.add(renderer.camera);
  state.localSwitchAt = 0;

  const modeText = welcome.mode === 'defusal' ? '拆弹模式' : '生化模式';
  hud.banner(`进入 ${modeText}`, `${welcome.mapName} · ${welcome.mods?.length ? `已加载 ${welcome.mods.length} 个 Mod` : '无 Mod'}`);
  sfx.roundStart();

  state.touchUI = setupTouch(input, (dx, dy) => {
    input.yaw -= dx * 0.0045;
    input.pitch = clamp(input.pitch - dy * 0.0045, -1.55, 1.55);
  }, {
    onShop: () => {
      toggleBuy(); // 拆弹=购买菜单，生化=选枪界面
    },
    onSwitchRequest: (slot, dir) => {
      if (slot != null) applyLocalSwitch(slot);
      else if (dir) localCycleWeapon(dir);
    },
    onChat: openMobileChat,
  });
  if (state.touchUI) {
    hud.r.hint.classList.add('hidden');
    // 生化模式：商店按钮用于打开“选枪”，保留并改标签；拆弹模式为购买菜单
    if (state.mode !== 'defusal') {
      const shopBtn = document.getElementById('shop-btn');
      const label = shopBtn?.querySelector('.btn-label');
      if (label) label.textContent = '选枪';
    }
  }

  loadClientMods({ net, hud, state }).then((mods) => {
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
  net.leave();
  $('room-code').textContent = '';
  if (state.scopeCanvas) {
    state.scopeCanvas.remove();
    state.scopeCanvas = null;
  }
  state.adsAmount = 0;
  // 重置武器状态，避免跨房间残留（如生化买过的 AE-7 在拆弹局闪出）
  state.selfWeaponId = null;
  state.selfPrimaryId = null;
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
  // 房主：当局结果写 room.data（单局共享；vibe.global 仅作品创作者可写，房主无法维护全服排行）
  if (net.isHost) {
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
    }
    if (msg.victim === state.selfId) {
      hud.damageFlash();
    }
    if (msg.victim === state.selfId && !msg.zombie) {
      sfx.roundEnd(false);
    }
    if (msg.killer === state.selfId) sfx.kill();
    dispatchMods(state.mods, 'kill', msg);
  });
  net.on('damage', (msg) => {
    hud.damageFlash();
    sfx.damage();
    dispatchMods(state.mods, 'damage', msg);
  });
  net.on('hit', (msg) => {
    hud.hitmarker(msg.headshot);
    sfx.hit(msg.headshot);
    dispatchMods(state.mods, 'hit', msg);
  });
  net.on('explosion', (msg) => {
    effects.explosion(msg.pos);
    sfx.explosion();
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
    hud.banner(`第 ${msg.round} 回合开始`, MODE_LABEL[state.mode]);
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
    const myTeam = state.self.team === 1
      ? (state.mode === 'defusal' ? 'CT' : 'HUMAN')
      : (state.mode === 'defusal' ? 'T' : 'ZOMBIE');
    const win = msg.winner === myTeam;
    const winPhrases = ['漂亮！', '干净利落！', '拿下这一分！'];
    const losePhrases = ['可惜…', '下一回合扳回来', '稳住心态'];
    const flavor = (win ? winPhrases : losePhrases)[(msg.round || 1) % 3];
    hud.banner(winnerText(msg), `第 ${msg.round || '?'} 回合 · ${reasonText(msg.reason)} · ${flavor}`, win);
    sfx.roundEnd(!!win);
    dispatchMods(state.mods, 'round_end', msg);
  });
  net.on('match_end', (msg) => {
    hud.banner('比赛结束', `胜者：${msg.winner}`);
    sfx.roundEnd(true);
    persistMatch(msg);
    dispatchMods(state.mods, 'match_end', msg);
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
  net.on('reloading', () => sfx.reload());
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
    if (msg.id === state.selfId) sfx.roundStart();
  });
}

function winnerText(msg) {
  const map = {
    CT: 'CT 方获胜', T: 'T 方获胜', HUMAN: '人类获胜！', ZOMBIE: '僵尸获胜！', DRAW: '平局 · 各得一分',
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
      rec = { last: e, next: e, t0: performance.now(), mesh, tag, zombie: !!e.zb, team: e.t, tagHp: -1, tagName: '', tagZombie: null, tagTeam: null, tagCarrier: null, tagMax: -1, tagFt: -1 };
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
      }
    }
    rec.mesh.visible = !!e.al;
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
  for (const [id, rec] of state.players) {
    if (!seen.has(id)) {
      renderer.scene.remove(rec.mesh);
      if (rec.tag) renderer.scene.remove(rec.tag);
      state.players.delete(id);
    }
  }
  for (const [id, m] of state.grenadeMeshes) {
    renderer.scene.remove(m);
    state.grenadeMeshes.delete(id);
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
  s.team = e.t;
  s.money = e.mo ?? 0;
  s.boughtItems = e.bi || [];
  s.kills = e.k ?? s.kills ?? 0;
  s.deaths = e.d ?? s.deaths ?? 0;
  // 诊断：出生后是否掉出地图
  window.__self = { y: e.y, alive: !!e.al };
  window.__minSelfY = Math.min(window.__minSelfY ?? Infinity, e.y);
  const d = distance(s.pos, { x: e.x, y: e.y, z: e.z });
  if (d > 2.8) {
    s.pos = { x: e.x, y: e.y, z: e.z };
    s.vel = { x: 0, y: 0, z: 0 };
  } else {
    s.pos.x = lerp(s.pos.x, e.x, 0.18);
    s.pos.y = lerp(s.pos.y, e.y, 0.18);
    s.pos.z = lerp(s.pos.z, e.z, 0.18);
  }
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
    if (!first && performance.now() - (state.localSwitchAt || 0) > 400) sfx.switchWeapon();
  } else if (!state.selfWeaponId) {
    state.selfWeaponId = e.w;
  const ewDef = weaponDef(e.w);
  if (e.w && ewDef && ewDef.slot === 2) state.selfPrimaryId = e.w;
  else if (e.w && !['fang', 'k9', 'thunder', 'zclaw'].includes(e.w)) state.selfPrimaryId = e.w; // Mod 武器视为主武器
  } else if (staleWeapon && !!e.zb !== state.self.isZombie) {
    // 僵尸形态变化强制跟随（切枪序号不覆盖变身）
    state.selfWeaponId = e.w;
    rebuildViewmodel(e.w);
    window.__viewmodelWeapon = e.w;
  }
  hud.setSelf(e, state.round, s.alive);
}

// 切换武器：预构建缓存 + 显隐切换，避免每帧同步建模造成卡顿
function rebuildViewmodel(id) {
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
    return state.selfPrimaryId || 'arc17';
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
  if (state.self.isZombie) {
    state.pendingSlot = 0;
    input.swdQueued = 0;
    return;
  }
  const cur = slotOfWeapon(state.selfWeaponId);
  state.pendingSlot = (cur + (dir > 0 ? 1 : 3)) % 4;
  applyLocalSwitch(state.pendingSlot);
  input.swdQueued = 0; // 事件已消费，下一帧不得再次循环
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
  } else if (frame.swd !== 0) {
    // 滚轮：事件回调已即时循环（并清空队列）；此处兜底处理未被回调消费的情况
    localCycleWeapon(frame.swd > 0 ? 1 : -1);
  }
  s.crouch = !!frame.c;
  s.yaw = frame.yaw;
  s.pitch = frame.pitch;
  const def = weaponDef(state.selfWeaponId) || BUILTIN_WEAPONS.k9;
  s.weaponMoveMult = def.moveMult || 1;
  if (frame.ads && !s.isZombie && !def.melee && !def.projectile) s.weaponMoveMult *= 0.78;
  if (s.alive && state.map) {
    movePlayer(s, frame, Math.min(dt, 0.05), state.map.colliders);
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
    k9:           { x: 0.02, y: -0.10, z: -0.58, fov: 58, scope: false },
    vx9:          { x: 0.02, y: -0.09, z: -0.56, fov: 54, scope: false },
    arc17:        { x: 0.02, y: -0.10, z: -0.56, fov: 52, scope: false },
    warden:       { x: 0.03, y: -0.08, z: -0.56, fov: 56, scope: false },
    longshot:     { x: 0,    y: 0,     z: -0.5,  fov: 16, scope: true },
    bruiser:      { x: 0.02, y: -0.09, z: -0.56, fov: 54, scope: false },
    energy_rifle: { x: 0.02, y: -0.10, z: -0.56, fov: 52, scope: false },
    cryo_gun:     { x: 0.02, y: -0.10, z: -0.56, fov: 54, scope: false },
    railgun:      { x: 0,    y: 0,     z: -0.5,  fov: 22, scope: true },
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
  // 平滑开镜：0（腰射）↔ 1（完全开镜）
  const targetAds = ap ? 1 : 0;
  state.adsAmount += (targetAds - state.adsAmount) * Math.min(1, dt * (ap && ap.scope ? 7 : 11));
  if (Math.abs(state.adsAmount) < 0.002 && targetAds === 0) state.adsAmount = 0;
  const t = state.adsAmount;
  // 倍率：从基础 FOV 平滑过渡到开镜 FOV
  const targetFov = ap ? ap.fov : settings.fov;
  cam.fov = lerp(settings.fov, targetFov, t);
  cam.updateProjectionMatrix();
  cam.rotation.order = 'YXZ';
  cam.rotation.y = s.yaw;
  cam.rotation.x = s.pitch;

  // 真镜片遮罩（狙击/磁轨）
  const scoped = !!(ap && ap.scope && t > 0.35);
  updateScopeOverlay(scoped, (t - 0.35) / 0.65);

  if (state.viewmodel) {
    const vm = state.viewmodel;
    state.vmKick = Math.max(0, state.vmKick - dt * 5);
    state.vmSwing = Math.max(0, state.vmSwing - dt * 4);
    // 开镜时持枪位姿（枪口/准星对齐屏幕中心），否则正常姿态
    const bob = moving() && s.grounded ? Math.sin(performance.now() * 0.009) : 0;
    const nX = 0.24 + Math.sin(performance.now() * 0.005) * 0.008 + bob * 0.004;
    const nY = -0.22 - state.vmKick * 0.04 - state.vmSwing * 0.08 + Math.abs(bob) * -0.008;
    const nZ = -0.5 + state.vmKick * 0.12 + state.vmSwing * 0.1;
    const aX = ap ? ap.x : nX;
    const aY = ap ? ap.y : nY;
    const aZ = ap ? ap.z : nZ;
    if (scoped) {
      vm.visible = false;
    } else {
      vm.visible = s.alive;
      vm.position.set(
        nX + (aX - nX) * t,
        nY + (aY - nY) * t,
        nZ + (aZ - nZ) * t
      );
      vm.rotation.x = (state.vmKick * 0.1 + state.vmSwing * 0.7) * (1 - t);
    }
    const muzzle = vm.userData.muzzle;
    if (muzzle && frame.fire && s.alive && (state.selfWeaponId === 'zclaw' || state.selfWeaponId === 'fang')) {
      state.vmSwing = 1;
    }
  }
}

function moving() {
  const s = state.self;
  return s.alive && s.grounded && (s.vel.x ** 2 + s.vel.z ** 2) > 0.4;
}

function updateCrosshair(dt, frame) {
  const s = state.self;
  const ap = frame.ads && !s.isZombie && s.alive ? adsParams(state.selfWeaponId) : null;
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
      state.vmSwing = 1;
      sfx.throw();
    }
    return;
  }
  if (def.melee) {
    if (performance.now() - (state.lastMeleeAt || 0) > 240) {
      state.lastMeleeAt = performance.now();
      state.vmSwing = 1;
      sfx.shot('melee');
      const dir = directionFromAngles(state.self.yaw, state.self.pitch);
      const from = { x: state.self.pos.x, y: state.self.pos.y + 1.6, z: state.self.pos.z };
      const to = { x: from.x + dir.x * 2.2, y: from.y + dir.y * 2.2, z: from.z + dir.z * 2.2 };
      effects.tracer(from, to, 0xd8ffd8);
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
  if (state.wasGrounded === false && state.self.grounded) sfx.land();
  state.wasGrounded = state.self.grounded;
  if (now - state.lastPingAt > 2000) {
    state.lastPingAt = now;
    net.ping();
  }
  fireVisuals(frame);
  updateCamera(dt, frame);
  updateCrosshair(dt, frame);

  // 其他玩家插值
  for (const rec of state.players.values()) {
    if (!rec.next.al) {
      rec.mesh.visible = false;
      continue;
    }
    const t = clamp((now - rec.t0 - 50) / 100, 0, 1);
    const a = rec.last;
    const b = rec.next;
    rec.mesh.position.set(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));
    rec.mesh.rotation.y = angLerp(a.ya, b.ya, t);
    rec.mesh.visible = true;
    if (rec.tag) {
      rec.tag.position.set(rec.mesh.position.x, rec.mesh.position.y + 2.5, rec.mesh.position.z);
      rec.tag.visible = rec.mesh.visible;
    }
    // 简易行走动画
    const speed = Math.hypot(b.x - a.x, b.z - a.z) * 10;
    const bob = speed > 0.5 ? Math.sin(now * 0.014) * 0.04 : 0;
    rec.mesh.position.y += bob;
    const parts = rec.mesh.userData.parts;
    if (parts) {
      const swing = speed > 0.5 ? Math.sin(now * 0.014) * 0.45 : 0;
      parts.armL.rotation.x = swing;
      parts.armR.rotation.x = -swing;
    }
  }

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
  if (state.buyOpen && now - state.lastBuyRenderAt > 250) {
    state.lastBuyRenderAt = now;
    renderBuyUI();
  }

  effects.update(dt);
  renderer.render();
}

// ---------------- 聊天 / 指针锁定 ----------------
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
  // 丧尸不能选枪
  if (state.mode === 'zombie' && state.self.isZombie) {
    hud.toast('丧尸不能选枪');
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
      { money: state.self.money ?? 0, items: state.zombieCatalog, equippedId: equipped },
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
window.__selfIsZombie = () => !!state.self.isZombie;
window.__selfWeaponId = () => state.selfWeaponId;
window.__selfMoney = () => state.self.money ?? 0;
window.__zombieEquippedId = () => state.zombieEquippedId;
window.__weaponDef = (id) => {
  const d = weaponDef(id);
  return d ? { name: d.name, slot: d.slot, fireRate: d.fireRate, auto: !!d.auto, sound: d.sound } : null;
};
window.__sceneChildren = () => renderer.scene.children.length;
window.__fpsProbe = () => { let frames = 0; const t0 = performance.now(); return new Promise((res) => { function tick() { frames++; if (performance.now() - t0 >= 2000) res(frames / 2); else requestAnimationFrame(tick); } requestAnimationFrame(tick); }); };

function boot() {
  bindSettingsUI();
  wireEvents();
  bindChatKey();
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
  $('leave-room-btn').onclick = () => {
    sfx.click();
    leaveRoom();
  };
  $('pause-btn').onclick = () => openPauseMenu();
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
