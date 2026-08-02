// 客户端武器注册表：BUILTIN_WEAPONS + 宿主下发的 Mod 武器 def。
// 服务端（房主）在 join 时通过 weapon_catalog 携带完整武器定义，
// 客户端据此驱动第一人称开火视觉/音效/准星/本地预测/名称，不再把 Mod 枪当空对象处理。

import { BUILTIN_WEAPONS } from '../shared/weapons.js';

const MOD_WEAPONS = {};

export function registerModWeapons(defs) {
  for (const d of defs || []) {
    if (d && d.id) MOD_WEAPONS[d.id] = d;
  }
}

export function weaponDef(id) {
  return MOD_WEAPONS[id] || BUILTIN_WEAPONS[id];
}

export function weaponName(id) {
  const d = weaponDef(id);
  return d ? d.name || id : id;
}
