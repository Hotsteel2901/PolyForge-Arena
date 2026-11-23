import vertex from './vertex.js';
import containment from './containment.js';
import obsidian from './obsidian.js';
import foundry from './foundry.js';
import hive from './hive.js';
import pit from './pit.js';
import citadel from './citadel.js';
import sanctum from './sanctum.js';
import metro from './metro.js';
import { generateNav } from './navgen.js';

const navCache = new Map();

function normalize(map) {
  for (const n of map.nav || []) n.y ??= 0;
  if (!navCache.has(map.id)) {
    let auto = [];
    try {
      auto = generateNav(map);
    } catch (err) {
      console.warn('[map] nav 生成失败，回退手写 nav', map.id, err);
    }
    const ok = auto.length >= 12;
    navCache.set(map.id, ok ? auto : (map.nav || []));
    map.navSource = ok ? 'auto' : 'manual';
  }
  map.nav = navCache.get(map.id);
  return map;
}

export const MAPS = {
  vertex: normalize(vertex),
  containment: normalize(containment),
  obsidian: normalize(obsidian),
  foundry: normalize(foundry),
  hive: normalize(hive),
  pit: normalize(pit),
  citadel: normalize(citadel),
  sanctum: normalize(sanctum),
  metro: normalize(metro),
};
