// Mod 加载器（浏览器版）：读取 mods/manifest.json 清单，用相对路径动态 import 加载
// mods/server/<id>/mod.js。必须用真实文件 URL（而非 blob），这样 mod 内的相对导入
// （如 ../../../shared/weapons.js）才能被浏览器正确解析。API 与原 server/mods.js 一致。

export function createModContext(room, meta) {
  return {
    id: meta.id,
    name: meta.name,
    version: meta.version,
    config: room.config,
    state: {},
    log(...args) {
      room.log(`[mod:${meta.id}]`, ...args);
    },
    registerWeapon(def) {
      if (def?.id) room.weapons.set(def.id, def);
    },
    registerMap(def) {
      if (def?.id) room.maps.set(def.id, def);
    },
    // ---- 第五批新增：规则 / 命令 / 玩家表 ----
    // 规则热更新会广播给所有客户端，本地预测与服务端共用同一套参数
    setRule(key, value) {
      room.setRule(key, value);
    },
    get rules() {
      return room.rules;
    },
    // 聊天命令：玩家输入 !name args 时触发（不给所有人广播）
    command(name, fn) {
      room.registerCommand(name, fn);
    },
    players() {
      return [...room.players.values()];
    },
    getPlayer(id) {
      return room.players.get(id) || null;
    },
    get mode() {
      return room.mode;
    },
    on(event, fn) {
      room.on(event, fn);
      return () => room.off(event, fn);
    },
    emit(event, data) {
      room.emit(event, data);
    },
    broadcast(type, payload) {
      room.broadcast({ type, payload });
    },
    sendTo(playerId, type, payload) {
      room.sendTo(playerId, { type, payload });
    },
    say(text) {
      room.say(`[${meta.name}] ${text}`);
    },
    // 只发给某个玩家（命令反馈用，不进公共聊天）
    tell(playerId, text) {
      room.sendTo(playerId, { type: 'chat', name: 'SYSTEM', text, system: true });
    },
  };
}

export async function loadServerMods(room, dir = '../mods') {
  const result = { loaded: [], errors: [] };
  let list = { server: [] };
  try {
    // fetch() 相对文档地址解析，线上页面在 /<slug>/ 下会把 ../mods 解析到 /mods（404）；
    // 因此用 import.meta.url（本模块真实地址）来解析清单 URL。
    const manifestUrl = new URL(`${dir}/manifest.json`, import.meta.url).href;
    const res = await fetch(manifestUrl);
    if (res.ok) list = await res.json();
  } catch {
    return result;
  }
  // enabled:false 的模组默认不加载（示例/实验性模组）；?mods=all 可强制全开
  const forceAll = typeof location !== 'undefined'
    && new URLSearchParams(location.search).get('mods') === 'all';
  for (const meta of list.server || []) {
    if (meta.enabled === false && !forceAll) continue;
    const id = meta.id;
    try {
      const mod = (await import(`${dir}/server/${id}/mod.js?v=${Date.now()}-${id}`)).default;
      if (!mod || typeof mod.init !== 'function') {
        throw new Error(`mod ${id}: missing init()`);
      }
      const ctx = createModContext(room, {
        id: mod.id || id,
        name: mod.name || meta.name || id,
        version: mod.version || meta.version || '0.0.0',
      });
      await mod.init(ctx);
      result.loaded.push({ id: ctx.id, name: ctx.name, ctx });
    } catch (err) {
      result.errors.push(`[${id}] ${err.message}`);
      room.log(`mod load error: ${err.message}`);
    }
  }
  return result;
}
