# PolyForge Arena · Mod 开发指南

游戏所有玩法都是数据驱动的：武器、地图、规则、HUD 都由 Mod 接口暴露。
不需要构建步骤，改完文件刷新页面即可（服务端 Mod 由房主加载，客户端 Mod 各端各加载）。

```
mods/
  manifest.json           # 清单：声明有哪些模组
  server/<id>/mod.js      # 服务端：武器 / 地图 / 规则 / 命令 / 事件
  client/<id>/mod.js      # 客户端：HUD 面板 / 准星 / 按键 / 事件
```

清单条目：

```json
{
  "server": [{ "id": "mutator", "name": "Mutator 规则包", "version": "1.1.0", "enabled": false }],
  "client": [{ "id": "tactical-hud", "name": "Tactical HUD", "version": "1.1.0", "enabled": false }]
}
```

- `enabled: false` 的模组默认不加载，用来放示例/实验性内容。
- 调试时在 URL 后加 `?mods=all` 可强制加载全部模组（含示例）。
- `id` 必须与目录名一致；`mod.js` 必须 `export default { id, name, version, init(ctx) }`。

---

## 一、服务端 Mod（`mods/server/<id>/mod.js`）

由房主加载并运行在权威模拟里，能改真正的游戏规则。

| 成员 | 说明 |
|---|---|
| `ctx.id / name / version / config / mode` | 元信息；`mode` 是当前模式 id（defusal / zombie / tdm / gungame） |
| `ctx.state` | 你的私有状态对象，跨事件保存数据 |
| `ctx.registerWeapon(def)` | 注册武器，`def` 结构见 `shared/weapons.js`（id/name/slot/damage/fireRate/magSize…） |
| `ctx.registerMap(def)` | 注册地图，结构见 `shared/maps/vertex.js` |
| `ctx.setRule(key, value)` | **热更新规则**，立即广播给所有客户端（本地预测同步生效） |
| `ctx.rules` | 当前规则表（只读引用） |
| `ctx.command(name, fn)` | 注册聊天命令 `!name args`，`fn(player, args, room)` |
| `ctx.tell(playerId, text)` | 只给某个玩家发系统消息 |
| `ctx.say(text)` | 全房间系统消息（自动带 `[模组名]` 前缀） |
| `ctx.broadcast(type, payload)` | 广播自定义消息，客户端 Mod 可订阅 |
| `ctx.sendTo(playerId, type, payload)` | 定向发送自定义消息 |
| `ctx.players()` / `ctx.getPlayer(id)` | 玩家列表 / 单个玩家（只读使用） |
| `ctx.on(event, fn)` | 订阅事件（返回取消订阅函数） |

### 可写规则

| key | 默认 | 作用 |
|---|---|---|
| `gravity` | `1` | 重力倍率（<1 低重力，客户端预测同步） |
| `friendlyFire` | `false` | 是否允许同队伤害 |
| `damageMult` | `1` | 全局伤害倍率 |
| `respawnDelay` | 模式默认 | 复活等待秒数（死斗/军备） |

自定义 key 也会一并同步给客户端，Mod 之间可以用它传参。

### 服务端事件

`player_spawn` `player_damage` `player_death` `round_start` `round_end` `bomb_planted`
`bomb_defused` `bomb_exploded` `explosion` `finale_start` `tick` `client_message`

`player_damage` 载荷：`{ victim, attacker, damage, armor, headshot, weapon }`；
`player_death` 载荷：`{ killer, victim, info }`。

### 示例：低重力 + 聊天命令

```js
export default {
  id: 'lowgrav', name: '低重力', version: '1.0.0',
  init(ctx) {
    ctx.setRule('gravity', 0.5);
    ctx.command('grav', (p, args) => {
      const v = Number(args[0]);
      if (v >= 0.1 && v <= 3) ctx.setRule('gravity', v);
      else ctx.tell(p.id, '用法：!grav 0.1~3');
    });
    ctx.on('player_death', ({ killer }) => {
      if (killer) killer.money += 100; // 直接改玩家对象（房主权威）
    });
  },
};
```

---

## 二、客户端 Mod（`mods/client/<id>/mod.js`）

| 成员 | 说明 |
|---|---|
| `ctx.state` | 私有状态；`ctx.state.selfId` 是你的玩家 id（进入对局后才有值） |
| `ctx.game` | 只读的游戏状态（`mode`、`players`、`self`、`rules`…） |
| `ctx.settings` | 玩家设置对象（灵敏度/音量等），改动后调用页面上的保存逻辑需自行处理 |
| `ctx.rules` | 当前规则表（服务端广播而来） |
| `ctx.hud.append(el)` | 把 DOM 元素挂到 HUD 右上角（`#mods-hud`） |
| `ctx.hud.toast(text)` / `ctx.hud.banner(title, sub)` | 提示条 / 大字横幅 |
| `ctx.hud.damageNumber(dmg, headshot)` | 弹伤害数字 |
| `ctx.hud.setCrosshair(html)` | 替换准星 DOM（慎用，会覆盖默认准星） |
| `ctx.onKey(code, fn)` | 绑定按键，`code` 用 `KeyboardEvent.code`（如 `KeyG`、`F8`） |
| `ctx.on(type, fn)` | 订阅**任意**协议消息：`kill` `hit` `damage` `shot_fx` `round_start` `rules` … |
| `ctx.emit(type, payload)` | 给房主发送自定义消息（房主侧 `client_message` 事件可收） |

### 示例：击杀计数面板

```js
export default {
  id: 'my-hud', name: '我的面板', version: '1.0.0',
  init(ctx) {
    const el = document.createElement('div');
    el.className = 'mod-panel';
    el.textContent = '击杀 0';
    ctx.hud.append(el);
    let k = 0;
    ctx.on('kill', (msg) => {
      if (msg.killer === ctx.state.selfId) el.textContent = `击杀 ${++k}`;
    });
    ctx.onKey('KeyG', () => ctx.hud.toast('你好'));
  },
};
```

样式可复用 `.mod-panel` / `.mp-row` / `.mp-hint`（见 `css/style.css`）。

---

## 三、内置示例

| 模组 | 端 | 演示内容 |
|---|---|---|
| `mutator` | server | `setRule` 热规则、`!grav` / `!ff` / `!rule` 命令、连杀事件播报 |
| `tactical-hud` | client | HUD 面板、订阅 `kill/hit/rules`、`F8` 显隐 |

两个示例默认 `enabled: false`，加 `?mods=all` 或把清单里的 `enabled` 改成 `true` 即可启用。

## 四、注意事项

- 服务端 Mod 由**房主**执行，联机时只有房主的改动生效；客户端 Mod 每个玩家各自加载。
- 不要在 `init` 里做重活（`init` 在房间启动前同步执行）；需要延后请用 `ctx.on('round_start', ...)`。
- 规则值会广播给所有客户端，**不要**把密钥类数据写进 `setRule`。
- 自定义消息请给 `type` 加前缀（如 `myhud_ping`），避免和内置协议冲突。
