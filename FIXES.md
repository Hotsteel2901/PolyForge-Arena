# PolyForge Arena 修复与优化报告

对 `Hotsteel2901/PolyForge-Arena` 做了完整代码审计（41 个文件、约 9200 行），
修复了 **30 处缺陷**，其中 7 处为影响核心玩法或移动端可用性的严重问题。
所有改动均经无头模拟与真实浏览器回归验证。

- 第二批（[第六节](#六第二批修复手感与表现层)）：近战枪口焰、近战模型与挥砍动作、
  完整换弹动画、行走抖动
- 第三批（[第八节](#八第三批修复移动端-ui-与操作体验)）：移动端 UI 与操作体验
- 第四批（[第十节](#十第四批修复切枪失效--动态摇杆)）：切枪失效修复、动态摇杆
- 第五批（[第十二节](#十二五第五批修复移动端聊天无法关闭)）：移动端聊天无法关闭

---

## 一、严重缺陷（影响核心玩法）

### 1. `sc` 字段重复定义，记分板得分被技能冷却覆盖 ★最严重

`host/room.js` 的 `snapshot()` 里 `sc` 被赋值两次，后者覆盖前者：

```js
sc: p.score,                                              // ← 得分，被下一行覆盖
...
sc: Math.max(0, Math.ceil((p.skillReadyAt || 0) - this.time)),  // ← 技能冷却秒数
```

影响范围（连锁三处）：
- 记分板"得分"列显示的是技能冷却秒数，且 `sort((a,b) => b.sc - a.sc)` 排序完全错乱
- `js/main.js` `applySelfState` 与 `js/hud.js` `setSelf` 读的确实是冷却，逻辑正确但被同一个字段挤占

**修复**：拆分为独立字段 `sk`（技能冷却），`sc` 归还得分语义；同步更新两个读取点。

### 2. 琉璃决战（生化模式末段）几乎不可能触发

`tick()` 中胜负判定在决战激活**之前**执行。实测 **12 局 0 次触发**——游戏最具设计感的
60 秒高潮内容形同虚设。

日志证据：
```
t=275.5  人类=2 僵尸=1  剩余=54.5s  决战=true     ← 决战确实激活了
t=276.0  人类=2 僵尸=1  剩余=54.0s  决战=true
回合结束于 276.3s  原因: zombies_eliminated        ← 但 5 秒后就被清场
```

**修复**：调整判定顺序（先决战、后胜负），并在丧尸全灭时给一次"最后感染"补位。
修复后 **12/12 触发**，持续 13–60 秒。

### 3. 丧尸 Bot 零误差锁头，人类毫无生还可能

`host/bots.js` `engage()` 中丧尸分支直接 `bot.yaw = Math.atan2(...)` 无任何瞄准误差，
且 `bot.input.fire = 1` 持续按住。配合 600 HP + 4 HP/s 回血，贴脸后爪爪必中。

对比：人类 Bot 有 `errScale` 误差与 `aimRefreshAt` 刷新机制——两套标准不一致，属于漏改。

**修复**：给丧尸 Bot 加上同款瞄准误差与平滑转向，挥爪改为有节奏（0.26–0.5s 间隔）。

---

## 二、玩法平衡问题

初始 1 只丧尸在 50 秒内滚成 5 只（**7 人 → 2 人**），感染雪崩导致回合平均仅 50 秒结束。

| 参数 | 修改前 | 修改后 | 理由 |
|---|---|---|---|
| 初始丧尸数 | 25%，最多 3 只 | 18%，最多 2 只 | 抑制开局数量优势 |
| 丧尸 HP / 回血 | 600 / 4.0 | 420 / 2.5 | 人类步枪 DPS 308，1.36s 即可击杀 |
| 丧尸速度 | 5.4 | 4.95 | 人类 4.6，原值可无脑贴脸 |
| 感染重生延迟 | 3.5s | 8s | 给人类喘息窗口，关键改动 |
| 尸爪伤害 | 60（2 爪秒杀） | 34（4 爪击杀） | 对齐"丧尸单爪伤害提升至 60"的意图但过惩罚 |
| 决战 猎人伤害 | 3.0× | 1.7× | 原值几秒清场 |
| 决战 尸王/尸仆 HP | 1200 / 800 | 2600 / 1500 | 让 Boss 能扛住集火 |
| 生化单局时长 | 300s | 330s | 需 >60s 决战段留出铺垫 |

**验证结果**（各 12 局）：

| 模式 | 修复前 | 修复后 |
|---|---|---|
| 生化 人类:丧尸胜率 | 25% : 75% | **75% : 25%**（600:200 的动态消耗战） |
| 生化 回合时长 | 平均 50s | 平均 262s |
| 拆弹 CT:T | — | **65 : 53**（118 回合，接近完美平衡） |
| 拆弹 整场回合数 | — | 16–23 回合，四种结束条件全覆盖 |

---

## 三、逻辑与代码质量

| # | 位置 | 问题 | 修复 |
|---|---|---|---|
| 4 | `host/room.js` `startRound()` | `all.filter((p) => !p.isBot \|\| true)` — `\|\| true` 恒真，整个 filter 是空操作 | 直接 `const players = all` |
| 5 | `host/room.js` `handleRoundEvent` | 两模式分支重复，生化模式 `matchScore[winner]` 在 `winner` 为 `null` 时会产生 `matchScore["null"]` 污染 | 合并共用计分逻辑，加 `!== undefined` 守卫 |
| 6 | `host/room.js` `tick()` | `if (p.isBot)` 连续判断两次 | 合并为单次判断 |
| 7 | `host/room.js` `resetEconomy()` | 生化模式也被重置为 `START_MONEY`(800)，与开局 1000 不一致 | 按模式区分；顺带清理购买记录与阶段状态 |
| 8 | `host/room.js` `activateFinale()` | 只 `broadcast` 给客户端，从未 `emit` 到本地事件总线，Mod 无法监听 | 补 `this.emit('finale_start', ...)` |
| 9 | `host/player.js` `giveLoadout()` | `mode === 'defusal' ? ... : ...` 位于 else 分支内，三元恒走假分支（死代码） | 简化为直接使用 arc17 |
| 10 | `host/hitscan.js` 穿透 | 多 hop 穿透伤害无衰减，磁轨枪一枪串死整队 | 加入 `pierceFalloff`（默认 0.7^n）衰减 |
| 11 | `js/main.js` `applySelfState` | 武器切换 `else if` 嵌套错误：`if (!state.selfWeaponId)` 分支内未更新 `selfPrimaryId`，而主武器记录逻辑错误地挂在 `else if` 链上 | 提取 `recordPrimary()` 函数，两个分支都正确调用 |
| 12 | `js/effects.js` `_flashSprite()` | 每次开火都新建 canvas + CanvasTexture，高频射击持续产生显存垃圾 | 贴图缓存为 `_flashTex`，并清理 muzzleLight 的 `setTimeout` 竞态 |
| 13 | `js/input.js` | 构造函数中 `swdQueued = 0` 重复赋值两次；`keydown` 内有空的 `if (Enter)` 死代码块 | 删除重复赋值，改为真正的 `chatOpen` 早退守卫 |
| 14 | `js/hud.js` `showUseProgress()` | 非 defuse 一律显示"安放炸弹…"，生化模式补给箱也显示安放炸弹 | 改为标签映射表，新增"补给中…" |

---

## 四、验证方式

无头模拟（Node，假 timer 驱动真实 `room.tick()`）：

- **字段正确性**：1500 次快照采样确认 `sc === p.score` 恒成立，`sk` 字段存在
- **拆弹模式**：6 局完整比赛跑完，118 回合，四种结束条件（全灭/拆除/爆炸/超时）全部出现
- **生化模式**：12 局单回合统计，三种结果（人类存活/丧尸全灭/全员感染）全部出现
- **决战触发**：12/12
- **Mod 系统**：3 个服务端 Mod（AE-7 / CR-7 / MG-9）全部加载成功，武器表正确注入，运行 60s 无异常
- **语法**：全仓库 37 个 JS 文件 `node --check` 全部通过
- **HTTP**：本地服务器验证 `index.html`、`js/main.js`、`mods/manifest.json` 均 HTTP 200

---

## 五、未改动项（经评估后保留）

- **网络与 VibeHub 集成**：未在沙箱内验证 P2P 链路，不做改动以免破坏线上行为
- **`js/music.js` / `shared/dnb-song.js`**（约 900 行 D&B 合成引擎）：审计未发现缺陷，设计良好
- **地图数据**（vertex / containment / obsidian）：nav 图与碰撞体自洽，未发现不合理处
- **移动端触控 UI**：逻辑完整，未发现缺陷

---

## 六、第二批修复（手感与表现层）

### 12. 近战武器开火有枪口焰

近战武器（匕首 `fang`、尸爪 `zclaw`）没有枪管，却复用了枪械的 `fireVisuals()` 分支，
每刀都在刀尖位置炸出一团枪口焰 + 点光源 + 直线上弹道，视觉上错得很明显。

**修复**（`js/main.js` `fireVisuals()`）：按武器类型分流，近战走新增的 `effects.slash()`，
手雷走投掷动画标记，只有枪械保留枪口焰。

```js
// 近战没有枪口：改用挥砍弧线，不再产生枪口焰与点光源
if (def.melee) {
  effects.slash(from, to, state.selfWeaponId === 'zclaw');
  vmRecoilFor(def, 0.45);   // 近战后坐更沉，但不给枪口焰
  return;
}
```

**新增 `effects.slash(from, to, isClaw)`**（`js/effects.js`）：在视线方向上以命中点为圆心
生成 11 段折线圆弧，替代直线弹道。尸爪弧长 1.5 rad / 半径 0.85（更宽、爪痕色 `0x9fe07a`），
匕首 1.15 rad / 半径 0.7（更窄、刃光色 `0xd8e8ff`），加法混合 + 淡出。

### 13. 尸爪 / 匕首模型与挥砍动作合理化

**模型**（`js/models.js`）：

| 武器 | 原问题 | 重做后 |
|---|---|---|
| `fang` 匕首 | 一个拉伸方块，无握柄/护手/刀锋区分 | 握柄 → 护手 → 扁平刀身（略上翘 `rx=-0.06`）→ 亮边刀锋 → 四棱锥刀尖 → 刀背凸起，共 6 段 |
| `zclaw` 尸爪 | 三根圆锥直接插在方块上，像三根钉子 | 掌部 + 腕部 + 三根独立爪（每根含指节 + 外张爪身），掌心血痕点缀 |

材质新增：`clawMat`（骨色 `0xe4dccb`，roughness 0.35）、`flesh`（`0x5d7434`）、`wound`（`0x8a3f3f`）。

**动作**（`js/main.js` `updateViewmodelAnim()`）：抽出独立的视图模型动画函数，
挥砍分「蓄力 → 下劈 → 收招」三段，蓄力占前 28%（匕首）/ 34%（尸爪），
挥砍时长与武器射速对齐而非写死：

```js
const swingDur = swingDef.melee
  ? Math.max(0.18, 60 / Math.max(1, swingDef.fireRate))
  : 0.25;
```

数值验证（`swing.mjs` 逐帧采样）：

| 武器 | 蓄力抬枪 | 下劈峰值俯仰 | 起手/收招归零 |
|---|---|---|---|
| 匕首 fang | −0.280 rad | **0.427 rad（24°）** | true / true |
| 尸爪 zclaw | −0.549 rad | **0.598 rad（34°）** | true / true |

尸爪幅度显著大于匕首，符合"笨重爪击 vs 轻快直刺"的定位；两者首尾均归零，无残留位移。

### 14. 新增完整换弹（上弹）动画

**问题**：`reloading` 事件此前只播了音效，玩家看到的是"弹匣突然满了"，缺少视觉反馈。

**修复**：服务端 `reloading` 事件带出的 `reloadTime` 直接驱动动画时长，
保证动画收尾与服务器逻辑严格同步（不会出现动画没播完子弹就满了，或反过来）：

```js
net.on('reloading', (msg) => {
  sfx.reload();
  const def = weaponDef(msg?.weapon || state.selfWeaponId) || {};
  const dur = def.reloadTime || 1.8;
  state.self.reloadAnim = { t: 0, dur: Math.max(0.4, dur) };
});
```

三段式动画（`updateViewmodelAnim()`）：

| 进度 | 阶段 | 表现 |
|---|---|---|
| 0–35% | 落枪 | 枪身下沉并外翻，弹匣方向微倾 |
| 35–70% | 换弹 | 下沉到底 + `sin(p*46)` 高频抖动（模拟插拔弹匣的顿挫） |
| 70–100% | 复位 | `easeOutCubic` 平滑回正 |

动画在 `rebuildViewmodel()`（换枪）时被置 `null` 打断，避免换枪后残留旧动画状态。

### 15. 行走时周期性抖动

**根因**：房主以 30Hz 下发快照，客户端每帧（60–144Hz）在本地做预测 + 碰撞求解。
旧实现每收到一次快照就 `lerp(位置, 0.18)` —— 快照把位置拽回服务器的旧估算值，
下一帧本地又预测出去，两个更新源不同频率互相拉扯，宏观上就是"走着走着抖几下"。

**修复**：把"逐帧插值"改为**增量校正量消费**（`js/main.js`）：

- `applySelfState()` 只计算误差 `d = |snapshot − local|`：
  - `d > 2.8m`（瞬移/复活）→ 直接吸附并清零速度
  - 否则记录为 `s.correction`，不立即改动位置
- `updateSelf()` 每帧按帧率无关的指数衰减消费该校正量：

```js
const k = 1 - Math.exp(-Math.min(dt, 0.05) * 8);
```

k 值经扫描标定（8 / 10 / 12 / 14 / 18 / 22 / 26），k=8 为最优：
既把行走速度突变压下来，又能在约 0.4s 内收敛干净、不留下可感知漂移。

**量化验证**（`jitter.mjs`）：连续 3000 帧记录每帧速度变化量的最大值。

| 指标 | 修复前 | 修复后 | 改善 |
|---|---|---|---|
| 最大速度突变 | 7.154 m/s | **2.148 m/s** | **−70%** |
| 收敛时间 | — | ≈0.4 s | 无残留漂移 |

---

## 七、第二批验证方式

- **抖动**：帧级速度突变采样（3000 帧），k 值扫描标定，改善 −70%
- **挥砍曲线**：逐帧采样位置/欧拉角，确认蓄力峰值、下劈幅度与首尾归零
- **调用链交叉验证**：`effects.slash` ↔ `main.js` 调用点；`reloadAnim` 四处
  （定义 / 触发 / 打断 / 消费）；`vmSwing` 六处触发点，全部一致
- **服务端回归**：重跑 `sim.mjs`，两种模式正常、`sc === score` 仍成立，未破坏第一批修复
- **语法**：全仓库 37 个 JS 文件 `node --check` 全部通过

---

## 八、第三批修复（移动端 UI 与操作体验）

移动端此前只有 `js/touch.js`（179 行）+ CSS 移动端区块，按钮位置全部硬编码
`right/bottom` 像素值，无任何自适应逻辑。按 4 种目标视口（iPhone 横屏 844×390、
安卓横屏 800×360、iPhone 竖屏 390×844、iPad 竖屏 820×1180）审计后发现 8 项缺陷。

### 16. 疾跑在触控端完全没有入口 ★功能性缺失

`shared/physics.js` 的疾跑条件是 `input.s && !p.isZombie && !p.crouch && input.mv[0]`，
而 `input.s` 只读键盘 Shift，`touch.js` 全文无任何疾跑代码 —— **触屏设备永远跑不起来**。

**修复**：摇杆推满自动疾跑。摇杆原先丢弃推程信息（`mvTouch` 只有 0/1 四方向位），
补上归一化推程 `mvMag`，并带 0.85/0.70 回滞避免边界抖动：

```js
const mag = Math.min(1, len / JOY_MAX);
input.mvMag = mag;
// 推满且朝前 → 疾跑。物理层本就要求 mv[0]（前进），
// 因此后退/侧移推满不触发，符合直觉。
if (mag > SPRINT_ON && nz < 0) setSprint(true);
else if (mag < SPRINT_OFF || nz >= 0) setSprint(false);
```

`js/input.js` 接入 `s` 字段，并把摇杆推满时加 `.sprinting` 类做视觉反馈
（边框变绿 + 短振动），让自动疾跑可被感知。

**验证**：实测走 4.60 m/s → 跑 5.98 m/s（1.30×，与 `SPRINT_MULT` 一致）；
后退/侧移推满均不触发（与物理层条件交叉验证）。

### 17. 竖屏下摇杆与切枪/雷按钮水平重叠 56px ★严重

竖屏 390×844 实测：摇杆 `x∈[24,152]`，切枪与雷 `x∈[96,152]` —— **完全重叠**。
根因是 `@media (max-height: 500px)` 只处理矮屏，竖屏高 844 不触发，按钮保持全尺寸。

**修复**：新增按宽度触发的竖屏媒体查询，收窄按钮簇与摇杆：

```css
@media (max-width: 560px) and (orientation: portrait) {
  #joy-base { width: 104px; height: 104px; }      /* 原 128 */
  #joy-knob { width: 44px; height: 44px; }
  #btn-cluster { transform: scale(0.7); transform-origin: bottom right; }
}
```

**验证**：390 宽下摇杆右缘 x=120、簇左缘 x=209，空隙 **89px**（原 −56px）。

### 18. 横屏下按钮超出拇指舒适可及区 ★严重

以屏高 45% 为舒适半径经验值，横屏 844×390 半径仅 176px，而最远的聊天键达 300px。
安卓横屏 800×360 更差（半径 162px，连换弹都超出）。

**修复**：按使用频率把按钮分三层，低频键移出触控簇：

| 层 | 位置 | 按钮 |
|---|---|---|
| 核心层（<170px） | 右下角拇指弧线 | 射击 / 跳 / 蹲 / 换弹 / 开镜 |
| 次核心层（170–230px） | 沿弧线外延 | 互动 / 切枪 |
| 低频层 | 屏幕顶部操作条 `#touch-topbar` | 全屏 / 计分 / 聊天 / 商店 / 技能 |

触控簇从 **12 个按钮减到 7 个**；切枪从 `right:226/bottom:140`（244px）
内收到 `186/80`（192px）。同时删除「雷」按钮——它绑定 `switchQueued = 3`
但 `main.js` 无任何消费点，是死按钮（手雷由切枪循环覆盖）。

**验证**：横屏最远按钮 192px（原 300px），4 视口均无按钮超出可及阈值。

### 19. 触控视角灵敏度写死，无视设置且开镜不减速

```js
input.yaw -= dx * 0.0045;   // 固定值，忽略 settings.sens
```

触控每像素 0.258° vs 鼠标 0.126°，是鼠标的 2 倍；且设置里的灵敏度对触屏**完全无效**。
更严重的是 ADS 开镜的灵敏度缩放只写 `input.sensitivity`，触控回调读不到 →
**开镜后准星移动速度不降**，狙击枪无法精细瞄准。

**修复**：新增 `input.effectiveSens` 暴露「设置值 × ADS 倍率」，触控回调改读它：

```js
// main.js 主循环，ADS 缩放计算之后
input.effectiveSens = input.sensitivity;

// setupTouch 回调
const s = 0.0022 * (input.effectiveSens || 1) * (settings.touchSens ?? 2);
```

基准从 0.0045 改为与鼠标同量纲的 0.0022 × 设置值；新增 `touchSens`（默认 2.0）
使 `0.0022×1×2 = 0.0044 ≈ 原 0.0045`，**默认手感零回归**（实测差 2.2%）。
设置面板新增「触控灵敏度」滑块，非触屏设备自动隐藏该行。

**验证**：狙击枪（fov 16）开镜后触控灵敏度 0.2521 → 0.0633 °/px，全程单调下降。

### 20. 技能按钮常驻且不随身份显隐

`touch.js` 无条件渲染「技能」按钮，拆弹模式按它毫无反应（`skillQueued` 无人消费）。
HUD 侧 `hud.js` 只在 `mode === 'zombie' && entry.zb` 时显示技能指示，两者标准不一致。

**修复**：新增 `ui.setSkillVisible()`，在 `hud.setSelf` 相邻处按同一标准调用：

```js
state.touchUI?.setSkillVisible?.(state.mode === 'zombie' && !!e.zb);
```

### 21. 切换类按钮无状态反馈

开镜（`input.ads`）与蹲下（`input.crouchHeld`）是 toggle，但按钮只翻转状态不改外观，
玩家无法判断当前是否已开镜/蹲下。

**修复**：新增 `.active` 样式（绿色边框 + 发光），toggle 后同步：

```js
tap(adsBtn, () => {
  input.ads = !input.ads;
  adsBtn.classList.toggle('active', input.ads);
}, 'ads');
```

### 22. 按钮不支持滑动跟手

`hold()` 只监听 `touchstart/touchend/touchcancel`，无 `touchmove`。
射击时手指一抖滑出按钮范围就断火（`touchend` 在按钮外触发）。

**修复**：补 `touchmove` 跟随，容差 `TOUCH_PAD = 28px`（约半根手指宽）：

```js
const inside = t.clientX >= r.left - TOUCH_PAD && t.clientX <= r.right + TOUCH_PAD
            && t.clientY >= r.top - TOUCH_PAD && t.clientY <= r.bottom + TOUCH_PAD;
if (inside) press(); else release();
```

### 23. `#touch-ui .zone` 特异性陷阱导致顶栏按钮全部重叠 ★隐蔽

基础规则 `#touch-ui .zone { position: absolute }`（特异性 1,1,0）会压过
纯类选择器 `.top-btn { position: relative }`（0,1,0），使顶栏按钮全部塌陷到
容器原点**互相重叠**——`elementFromPoint` 只会命中最后一个，其余全部点不到。

这个坑在旧代码里就存在（旧按钮逐个指定了 `right/bottom` 坐标，掩盖了问题），
新增的顶栏因依赖 flex 排布才暴露出来。

**修复**：用同特异性的 `#touch-ui .top-btn { position: static }` 覆盖。
同时给 `#touch-ui` 加 `z-index: 12`（高于 HUD 的 10），避免 HUD 元素抢走命中。

### 24. 全屏引导

移动浏览器地址栏持续占位，横屏下进一步压缩可视区；也无横屏引导。

**修复**：进入对局时尝试全屏 + 横屏锁定（失败静默，iOS 需用户手势）；
顶部操作条提供「⛶」全屏按钮作为可靠入口（用户手势触发）；
竖屏时显示可关闭的「建议横屏」轻提示，不阻塞游玩。

---

## 九、第三批验证方式

三层验证，全部通过：

| 层 | 脚本 | 内容 | 结果 |
|---|---|---|---|
| 静态几何 | `mobile-geom.mjs` | 从 CSS 解析真实布局，4 视口 × 缩放档位断言不重叠/可及/占屏比 | **21/21** |
| 输入链路 | `mobile-input.mjs` | import 真实 `input.js`/`physics.js`，验证疾跑加速、灵敏度等效、技能门控 | **25/25** |
| 真实浏览器 | `mobile-browser.mjs` | headless Chrome 移动视口，合成 TouchEvent 跑完整交互链路 | **48/48** |

浏览器测试覆盖：UI 结构（7+5 按钮）、真实 `getBoundingClientRect` 重叠检测、
射击按住/松开、开镜切换与高亮、摇杆推满疾跑与回中、视角划动、滑动跟手
（容差内保持/超容差松手）、顶栏低频键、横屏提示显隐。

**服务端回归**：重跑 `sim.mjs`，两模式正常、`sc === score` 仍成立，未破坏前两批修复。
**桌面回归**：1600×900 无触摸下不创建触控 UI、保留键盘提示，桌面路径未受影响。
**语法**：全仓库 37 个 JS 文件 `node --check` 通过。

> 测试期间发现并修正了 3 个测试自身的缺陷（CSS 多属性同行解析、
> 事件名大小写、触摸目标锁定语义），非实现问题。

---

## 十、第四批修复（切枪失效 + 动态摇杆）

本批源于实机反馈：**移动端无法切枪**、**固定摇杆操作难受**。

### 25. `tap()` 复用 `hold()` 导致按钮抖动时重复触发 ★切枪失效主因

`js/touch.js` 的 `hold()` 为支持「滑动跟手」（手指滑出按钮仍保持按下），
在 `touchmove` 里重新判定 `inside`，回到按钮内就再调一次 `press()`：

```js
const press = () => { if (down) return; down = true; ...; onStart(); };
el.addEventListener('touchmove', (e) => {
  if (inside) press(); else release();   // ← 滑回按钮内会再触发一次 onStart
});
```

而 `tap()` 当时只是 `hold(el, fn, () => {}, key)`，于是轻点类按钮的 `onStart`
变成**可重复触发**。但它们的业务语义是**边沿触发**（按一次 = 干一件事）。

**实测**（`tap-compare.mjs`，同一段触摸：按下 → 滑出 → 滑回 ×3）：

| 实现 | 一次触摸的触发次数 | 表现 |
|---|---|---|
| 旧（`tap` 复用 `hold`） | **4 次** | 连切 4 把枪，最终又绕回原武器 → 「切不了枪」 |
| 新（独立边沿触发） | **1 次** | 正常切一把 |

影响面：

- `jump` / `reload` / `skill` → 重复动作，玩家不易察觉
- `ads` / `crouch` → `input.ads = !input.ads` 来回翻转，表现为「按了没反应」
- `switch` → 连切多把后绕回原样，**表现为切枪完全失效**

触摸屏上手指几乎不可能完全静止，故该 bug 在真机上必然出现。

**修复**：把 `tap` 从 `hold` 里拆出，独立实现边沿触发 ——
同一手势只认一次，抬手/取消后才复位，不再挂 `touchmove`：

```js
const tap = (el, fn, key) => {
  let fired = false;
  el.addEventListener('touchstart', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (fired) return;        // 同一手势内不重复触发
    fired = true;
    el.classList.add('pressed');
    if (navigator.vibrate) navigator.vibrate(12);
    window.__touchDebug[key]++;
    fn();
  }, { passive: false });
  const reset = () => { fired = false; el.classList.remove('pressed'); };
  el.addEventListener('touchend', (e) => { e.stopPropagation(); reset(); }, { passive: false });
  el.addEventListener('touchcancel', reset);
};
```

`hold` 的滑动跟手保持不变（射击键必需），两者语义彻底分离。

### 26. 客户端本地环切与房主持有武器不一致 ★切枪失效第二个成因

`js/main.js` 的 `localCycleWeapon()` 在客户端硬编码 4 槽循环：

```js
const cur = slotOfWeapon(state.selfWeaponId);
state.pendingSlot = (cur + (dir > 0 ? 1 : 3)) % 4;   // ← 客户端认为有 4 把枪
applyLocalSwitch(state.pendingSlot);
```

但房主端 `host/room.js` 只在**实际持有的槽位**里循环：

```js
const slots = [...p.weapons.keys()].sort((a, b) => a - b);
if (slots.length > 1) { ... p.activeSlot = slots[(idx + dir) % slots.length]; }
```

刚出生时玩家只有主武器（slot 2）+ 手枪（slot 1），共 2 把。客户端却按 4 槽切，
乐观切到空槽后被房主的「无效切枪」分支回执打回：

```js
} else {
  // 无效切枪（如无主武器时按 2）：立即回执当前武器，避免客户端乐观切枪后闪回
  this.sendTo(p.id, { type: 'switch', w: cur?.def.id ?? '', slot: p.activeSlot, seq: p.switchSeq });
}
```

表现为 **切枪闪烁后回到原武器**，与缺陷 25 叠加时完全无法切枪。

**修复**：客户端不再猜测目标，「下一把是哪把」交由房主决定
（只有房主知道玩家真实持有哪些武器）：

```js
function localCycleWeapon(dir) {
  if (state.self.isZombie) return;
  // 只发送循环方向，由房主决定切到哪把枪
  input.swdQueued = dir > 0 ? 1 : -1;
}
```

同时移除 `updateSelf()` 里对 `frame.swd` 的兜底重复消费 ——
回调与逐帧两处都处理会导致**一次点击切两把**。
`input.js` 的 `wheel()` 也不再直接写 `swdQueued`，统一由
`localCycleWeapon` 单一决策点写入。

### 27. 丧尸形态下切枪是死路

`localCycleWeapon` 的丧尸分支设 `pendingSlot = 0`，而 `weaponIdForSlot(0)`
对丧尸返回 `'zclaw'`（与当前武器相同）→ `applyLocalSwitch` 返回 `false`，
什么也不发生。按「切枪」永远无效。

**修复**：丧尸形态直接 `return`，不设 `pendingSlot`；
UI 侧新增 `ui.setSwitchEnabled(on)`，`main.js` 按 `!e.zb` 调用，
丧尸时切枪键置灰且屏蔽 `pointer-events`，避免玩家反复点击却毫无反馈。

### 28. 固定摇杆改为动态（浮动）摇杆

**问题**：`#joy-base` 是左下角固定的 128px 圆，`touchstart` 绑在圆上，
原点永远是圆心。三个痛点：

1. 手指必须精准落进 128px 圆内，盲操常按空 → 该次触摸完全无响应
2. 落点偏离圆心会立刻产生一个斜方向（原点在圆心，手指位置自带偏移）
3. 圆固定占着屏幕左下角，视觉噪音大

**修复**：改为动态摇杆（现代手游 FPS 标准做法）：

- 新增 `#joy-zone` 热区，占屏 **42% 宽 × 55% 高**，贴左下角
- 热区内**任意落点即摇杆原点**（`joyOrigin = { x: t.clientX, y: t.clientY }`）
- **底座跟随手指**：底座用 `translate` 跟到手指当前位置，摇杆头始终居中；
  方向向量仍由「相对起手点的位移」给出 —— 两者分离才可同时做到
  「底座贴着手指」与「推程正确反映手指移动距离」
- 抬手归位：`idleJoy()` 收起激活态，回到底左半透明提示圈待机

热区层级放在 `#look-zone` 之后，同 z-index 下后者优先命中，
确保热区内触摸不会被视角区分走。

**测试中发现的坐标系缺陷**：底座是 `#joy-zone` 的子元素，`absolute`
定位相对的是 **zone 而非视口**，故 `translate(x, y)` 必须减去 zone 原点。
初版漏了这一步，实测底座中心比落点**低 175px**（恰好等于 zone 顶边 y），
摇杆会整个跑到屏幕外。已修正为：

```js
const zr = joyZone.getBoundingClientRect();
joyBase.style.transform =
  `translate(${x - zr.left}px, ${y - zr.top}px) translate(-50%, -50%)`;
```

修复后实测底座中心与落点**完全重合**（180,300 → 180.0,300.0）。

同时移除矮屏媒体查询里对 `#joy-base` 的 `transform: scale()` ——
它会覆盖 JS 写入的 `translate`，导致底座瞬间弹回原位。

---

## 十一、第四批验证方式

| 层 | 脚本 | 内容 | 结果 |
|---|---|---|---|
| 边沿触发 | `tap-edge.mjs` | 从真实源码抽取 `hold`/`tap`，断言抖动/滑出滑回/连点/cancel 下的触发次数 | **16/16** |
| 切枪流程 | `switch-flow.mjs` | 断言只发方向不做本地推测、丧尸形态无操作、单次点击只切一把、房主按实际槽位循环 | **27/27** |
| 动态摇杆 | `joy-dynamic.mjs` | 热区结构与层级、落点即原点、底座跟手、坐标系修正、抬手归位、方向与推程 | **48/48** |
| 真实浏览器 | `mobile-fix-verify.mjs` | 移动视口实测热区命中、底座中心与落点重合、底座跟手、切枪边沿触发 | **25/25** |

**关键回归对照**（`tap-compare.mjs`）：同一段触摸手势下，
旧实现触发 **4 次**、新实现触发 **1 次**，确认修复直达根因。

**回归套件**（全部通过，确认前四批未相互破坏）：

| 套件 | 结果 |
|---|---|
| `mobile-geom.mjs` 布局几何 | 21/21 |
| `mobile-input.mjs` 输入链路 | 25/25 |
| `mobile-browser.mjs` 浏览器交互（横屏 + 竖屏） | 48/48 |
| `sim.mjs` 服务端（`sc === score`） | 通过 |
| `desktop-check.mjs` 桌面端 | 不创建触控 UI |
| `swing.mjs` / `jitter.mjs` | 挥砍曲线与抖动抑制未变 |
| 全仓库语法 | 41 个 JS 文件通过 |

> 测试期间发现并修正了 2 个测试自身的缺陷（注释中的关键字被误判为代码、
> 坐标系断言未随实现更新），以及 1 个实现缺陷（摇杆底座坐标系偏移 175px）。

---

---

## 十二、第五批修复（移动端聊天无法关闭）

### 29. 移动端聊天栏打开后无法关闭 ★移动端功能缺失

**症状**：手机上点顶部操作条的「聊天」后，输入框一直挂在屏幕顶部，没有任何办法收起。

**根因**：`js/hud.js` 的 `bindChat()` 只监听了 `#chat-input` 的 `keydown`：

```js
this.r.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { ... this.closeChat(); ... }
  else if (e.key === 'Escape') { this.closeChat(); }
  e.stopPropagation();
});
```

这是**唯一的**退出路径，而：

- 手机没有 Esc 键
- 输入框是 `type="text"` 且**不在 `<form>` 内**，虚拟键盘的「前往/发送」键
  不保证产生 `keydown`

于是 `closeChat()` 永远不被调用，`#chat-wrap.mobile-open` 一直挂着 ——
而该样式正是把聊天区拉到屏幕顶部的那条规则，表现就是「栏一直显示在那，关不掉」。

真实浏览器复现（`chat-repro.mjs`，移动视口）：

```
buttonsInWrap     : 0        ← 输入框周围没有任何关闭/发送按钮
inputForm         : false    ← 无 form，虚拟键盘"前往"键无效
afterBlur.chatOpen: true     ← 触摸别处失焦也不会关闭
```

即移动端**完全没有可用退出入口**。

**修复**：

1. `index.html` — 新增 `#chat-input-row`，内含 `#chat-send-btn`（发送）
   与 `#chat-close-btn`（关闭），默认 `.hidden`，仅触屏打开聊天时显示
2. `js/hud.js`
   - 抽出 `submitChat()`，由 Enter 键与「发送」按钮共用，避免逻辑漂移
   - `openChat()` 按 `isTouchPrimary()` 决定是否显示两个按钮
   - `closeChat()` 收起按钮 + 移除 `mobile-open` + `blur()`（让虚拟键盘收起）
   - 按钮绑定 `touchstart` 而非 `click`：虚拟键盘弹出时输入框持有焦点，
     部分移动浏览器上 `click` 需先失焦（两段式），`touchstart` 更可靠；
     保留 `click` 兜底并用标志位防双触发
   - 输入框**失焦且内容为空**时自动关闭 —— 避免「键盘收了但栏还挂着」
     （有内容时保留，防止误丢草稿）
3. `css/style.css` — `#chat-input-row` flex 布局；按钮 `min-height: 44px`
   适配触控；发送/关闭用不同配色的边框明确区分

### 30. 修按钮时发现的两个连带缺陷

**(a) 按钮点不中 —— `#hud` 的 `pointer-events: none` 被继承**

`#hud { pointer-events: none }` 用于让 HUD 不吃游戏点击，新加的按钮继承了
这份 `none`，实测 `elementFromPoint` 直接穿透到 `game` canvas ——
**按钮在真机上完全点不动**。已给 `#chat-input-row .btn` 显式补
`pointer-events: auto`。

**(b) `z-index` 越不过父级层叠上下文**

初版给 `#chat-wrap.mobile-open` 写了 `z-index: 15` 想压住触控层（12），
但 `#chat-wrap` 在 `#hud`（`z-index: 10`）内部，**子元素的 z-index 无法
越过父级建立的层叠上下文**，15 实际仍被夹在 10 里。

改为：输入态下给 `#touch-ui` 加 `.touch-disabled`（该规则已存在，
原本用于暂停面板），让铺满全屏的 `#look-zone` 暂时让路；关闭时解除，
且若此时暂停面板仍显示则不解除，交给 `setPaused` 统一同步。

---

## 十三、第五批验证方式

| 层 | 脚本 | 内容 | 结果 |
|---|---|---|---|
| 真实浏览器 | `chat-mobile.mjs` | 移动视口 + 桌面视口，覆盖按钮显隐、关闭、发送、空输入、失焦自动关闭、遮挡与恢复 | **35/35** |

`chat-mobile.mjs` 覆盖的关键断言：

- 打开后发送/关闭按钮**可见**（触屏唯一出口）
- 点「关闭」→ `chatOpen=false`、输入框隐藏、**`mobile-open` 移除**、
  按钮收起、输入框失焦、`onClose` 回调触发（恢复指针锁定）
- 点「发送」→ 回调收到文本且同样关闭
- 仅空白内容点「关闭」**不触发**发送
- 空输入失焦 → 自动关闭；有内容失焦 → **保留**不丢草稿
- 两个按钮中心 `elementFromPoint` 命中自身（**本次修的穿透缺陷**）
- 输入时 `#touch-ui` 让路；关闭后射击键**重新可命中**
- 桌面端：按钮不显示、`mobile-open` 不用、Enter/Esc 行为不变

**回归**（确认前五批未相互破坏）：

| 套件 | 结果 |
|---|---|
| `tap-edge.mjs` | 16/16 |
| `switch-flow.mjs` | 27/27 |
| `joy-dynamic.mjs` | 48/48 |
| `mobile-fix-verify.mjs` | 25/25 |
| `mobile-geom.mjs` | 21/21 |
| `mobile-input.mjs` | 25/25 |
| `mobile-browser.mjs` | 48/48 |
| `sim.mjs` 服务端（`sc === score`） | 通过 |
| `desktop-check.mjs` 桌面端 | 不创建触控 UI |
| 全仓库语法 | 41 个 JS 文件通过 |

> 测试期间修正了 1 个测试自身缺陷（未模拟进入对局导致 `#hud` 为 hidden、
> 输入框 `display:none` 被浏览器拒绝 focus），并发现 2 个实现缺陷
> （按钮 `pointer-events` 穿透、`z-index` 层叠上下文误用）。

---

## 十四、已知限制

- 视觉效果（挥砍弧线、换弹动画、模型造型、按钮观感）为逐帧数值、CSS 几何与
  无头浏览器验证，**未经真人真机试玩确认** —— 建议实机开一局验收手感
- P2P 链路未在沙箱内验证，网络同步相关的改动仅做静态调用链核对
  （第四批的切枪改动涉及房主回执，建议实机双端验证）
- 全屏/横屏锁定依赖浏览器支持，iOS Safari 需用户手势（已提供按钮兜底）
- 移动端物理与伤害数值未改动，沿用第二批标定结果
- 动态摇杆的手感参数（热区占比 42%×55%、`JOY_MAX` 54px、死区 8px）为
  经验值，实机若感觉推程偏长/偏短可调 `js/touch.js` 顶部常量
