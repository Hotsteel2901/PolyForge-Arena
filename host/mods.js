// Mod 加载器（浏览器版）：读取 mods/manifest.json 清单，用相对路径动态 import 加载
// mods/server/<id>/mod.js。必须用真实文件 URL（而非 blob），这样 mod 内的相对导入
// （如 ../../../shared/weapons.js）才能被浏览器正确解析。API 与原 server/mods.js 一致。

export function createModContext(room, meta) {
  return {
    id: meta.id,
    name: meta.name,
    version: meta.version,
    mode: room.mode,
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
  for (const meta of list.server || []) {
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
