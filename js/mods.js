// 客户端 Mod 加载（浏览器版）：读取 mods/manifest.json 清单，用相对路径动态 import
// mods/client/<id>/mod.js。原 /api/mods 接口被静态清单取代。

export async function loadClientMods({ net, hud, state }) {
  const loaded = [];
  let list = { client: [] };
  try {
    // 同 host/mods.js：fetch 相对文档地址解析，线上要用 import.meta.url 定位清单
    const res = await fetch(new URL('../mods/manifest.json', import.meta.url));
    if (res.ok) list = await res.json();
  } catch {
    return loaded;
  }
  for (const meta of list.client || []) {
    try {
      const mod = (await import(`../mods/client/${meta.id}/mod.js?v=${Date.now()}-${meta.id}`)).default;
      if (!mod || typeof mod.init !== 'function') continue;
      const listeners = new Map();
      const ctx = {
        id: meta.id,
        name: meta.name,
        version: meta.version,
        state: {},
        log(...args) {
          console.log(`[mod:${meta.id}]`, ...args);
        },
        // 客户端不注册武器/地图（武器真实定义由房主 weapon_catalog 下发），提供空实现以免 mod 报错
        registerWeapon() {},
        registerMap() {},
        on(type, fn) {
          if (!listeners.has(type)) listeners.set(type, []);
          listeners.get(type).push(fn);
          return () => {
            const l = listeners.get(type) || [];
            const i = l.indexOf(fn);
            if (i >= 0) l.splice(i, 1);
          };
        },
        emit(type, payload) {
          net.mod(type, payload);
        },
        hud: {
          append(el) {
            hud.appendMod(el);
          },
          setCrosshair(html) {
            hud.setCrosshair(html);
          },
        },
      };
      await mod.init(ctx);
      ctx.state.selfId = state?.selfId;
      loaded.push({ meta, ctx, listeners });
    } catch (err) {
      console.error(`[client mod ${meta?.id}] load error:`, err);
    }
  }
  return loaded;
}

export function dispatchMods(mods, type, data) {
  for (const m of mods) {
    for (const fn of m.listeners.get(type) || []) {
      try {
        fn(data, m.ctx);
      } catch (err) {
        console.error(`[client mod ${m.meta.id}] handler error:`, err);
      }
    }
  }
}
