// 经济系统纯数据与价格表。

export const PRICES = Object.freeze({
  k9: 400,
  vx9: 1300,
  arc17: 2700,
  warden: 1800,
  longshot: 4600,
  bruiser: 4200,
  armor: 650,
  grenade: 300,
});

export const START_MONEY = 800;
export const MONEY_CAP = 16000;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3000;
export const LOSS_REWARD = 1500;
export const PLANT_REWARD = 300;
export const DEFUSE_REWARD = 300;

// 生化模式经济：初始 1000，每击杀一只丧尸 +200
export const ZOMBIE_START_MONEY = 1000;
export const ZOMBIE_KILL_REWARD = 200;

// 任意主武器的价格：优先武器自身的 cost（Mod 武器用），否则查内置价格表
export function weaponPrice(def) {
  if (def && Number.isFinite(def.cost)) return def.cost;
  return PRICES[(def && def.id) || ''] ?? 800;
}

// armor 已满时价格为 0（视为“已拥有”，不可购买）
export function costOf(item, p) {
  if (item === 'armor') return p.armor >= 100 ? 0 : PRICES.armor;
  return PRICES[item] ?? -1;
}
