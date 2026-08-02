// 数据驱动武器：定义 + 运行时（射速、弹匣、换弹、伤害）。
// 射速规划（RPM，半自动为扳机边沿触发）：
//   Fang 匕首 170（自动挥砍） | K9 手枪 300（半自动）
//   VX9 冲锋枪 900 | ARC-17 步枪 660 | Bruiser 机枪 720
//   Warden 霰弹 85（半自动） | Longshot 狙击 45（半自动）
//   Thunder 手雷 55（半自动） | 尸爪 72（自动）

export const BUILTIN_WEAPONS = Object.freeze({
  fang: {
    id: 'fang',
    name: 'Fang 匕首',
    slot: 0,
    auto: true,
    melee: true,
    range: 2.4,
    fireRate: 170,
    damage: 40,
    headshotMult: 1,
    pellets: 1,
    magSize: Infinity,
    reserve: Infinity,
    reloadTime: 0,
    spread: 0,
    adsSpread: 0,
    recoil: 0.01,
    moveMult: 1.05,
    falloffNear: 1.5,
    falloffFar: 2.4,
    falloffMin: 0.9,
  },
  k9: {
    id: 'k9',
    name: 'K9 手枪',
    slot: 1,
    auto: false,
    fireRate: 300,
    damage: 32,
    headshotMult: 1.8,
    pellets: 1,
    magSize: 12,
    reserve: 48,
    reloadTime: 1.4,
    spread: 0.03,
    adsSpread: 0.008,
    recoil: 0.025,
    moveMult: 1,
    falloffNear: 12,
    falloffFar: 55,
    falloffMin: 0.45,
    sound: 'pistol',
  },
  vx9: {
    id: 'vx9',
    name: 'VX9 冲锋枪',
    slot: 2,
    auto: true,
    fireRate: 900,
    damage: 20,
    headshotMult: 1.7,
    pellets: 1,
    magSize: 30,
    reserve: 120,
    reloadTime: 1.9,
    spread: 0.045,
    adsSpread: 0.012,
    recoil: 0.016,
    moveMult: 1,
    falloffNear: 10,
    falloffFar: 45,
    falloffMin: 0.4,
    sound: 'smg',
  },
  arc17: {
    id: 'arc17',
    name: 'ARC-17 突击步枪',
    slot: 2,
    auto: true,
    fireRate: 660,
    damage: 28,
    headshotMult: 1.8,
    pellets: 1,
    magSize: 30,
    reserve: 120,
    reloadTime: 2.2,
    spread: 0.035,
    adsSpread: 0.008,
    recoil: 0.02,
    moveMult: 0.9,
    falloffNear: 15,
    falloffFar: 65,
    falloffMin: 0.45,
    sound: 'rifle',
  },
  warden: {
    id: 'warden',
    name: 'Warden 霰弹枪',
    slot: 2,
    auto: false,
    fireRate: 85,
    damage: 12,
    headshotMult: 1.4,
    pellets: 8,
    magSize: 8,
    reserve: 40,
    reloadTime: 2.8,
    spread: 0.09,
    adsSpread: 0.045,
    recoil: 0.06,
    moveMult: 0.82,
    falloffNear: 8,
    falloffFar: 28,
    falloffMin: 0.3,
    sound: 'shotgun',
  },
  longshot: {
    id: 'longshot',
    name: 'Longshot 狙击枪',
    slot: 2,
    auto: false,
    fireRate: 45,
    damage: 120,
    headshotMult: 2.2,
    pellets: 1,
    magSize: 5,
    reserve: 25,
    reloadTime: 3.2,
    spread: 0.02,
    adsSpread: 0.001,
    recoil: 0.09,
    moveMult: 0.72,
    falloffNear: 30,
    falloffFar: 200,
    falloffMin: 0.75,
    sound: 'sniper',
  },
  bruiser: {
    id: 'bruiser',
    name: 'Bruiser 轻机枪',
    slot: 2,
    auto: true,
    fireRate: 720,
    damage: 24,
    headshotMult: 1.6,
    pellets: 1,
    magSize: 100,
    reserve: 200,
    reloadTime: 4.2,
    spread: 0.05,
    adsSpread: 0.016,
    recoil: 0.022,
    moveMult: 0.78,
    falloffNear: 12,
    falloffFar: 55,
    falloffMin: 0.4,
    sound: 'lmg',
  },
  thunder: {
    id: 'thunder',
    name: 'Thunder 手雷',
    slot: 3,
    auto: false,
    projectile: 'grenade',
    fireRate: 55,
    damage: 180,
    headshotMult: 1,
    pellets: 1,
    magSize: 99,
    reserve: 0,
    reloadTime: 1,
    spread: 0,
    adsSpread: 0,
    recoil: 0,
    moveMult: 1,
    falloffNear: 3,
    falloffFar: 11,
    falloffMin: 0.25,
    sound: 'throw',
  },
});

export const WEAPON_IDS = Object.keys(BUILTIN_WEAPONS);

export class WeaponRuntime {
  constructor(def) {
    this.def = def;
    this.ammo = def.magSize;
    this.reserve = def.reserve;
    this.state = 'ready'; // ready | reloading | empty
    this.nextFireAt = 0;
    this.reloadEnd = 0;
  }

  get interval() {
    return 60 / Math.max(1, this.def.fireRate);
  }

  canFire(time) {
    return this.state === 'ready' && this.ammo > 0 && time >= this.nextFireAt;
  }

  fire(time) {
    if (!this.canFire(time)) return { ok: false };
    this.ammo -= 1;
    this.nextFireAt = time + this.interval;
    if (this.ammo === 0) this.state = 'empty';
    return { ok: true, ammo: this.ammo };
  }

  startReload(time) {
    if (this.state === 'reloading' || this.reserve <= 0 || this.ammo === this.def.magSize) {
      return { ok: false };
    }
    this.state = 'reloading';
    this.reloadEnd = time + this.def.reloadTime;
    return { ok: true };
  }

  update(time) {
    if (this.state === 'reloading' && time >= this.reloadEnd) {
      const need = this.def.magSize - this.ammo;
      const take = Math.min(need, this.reserve);
      this.ammo += take;
      this.reserve -= take;
      this.state = this.ammo > 0 ? 'ready' : 'empty';
      return { type: 'reloaded', ammo: this.ammo, reserve: this.reserve };
    }
    return null;
  }

  // 跨局复用前重置时间状态：房主每局把 time 归零，旧的 nextFireAt/reloadEnd
  // 会让 canFire(0) 永远为 false，导致买来的枪整局打不出伤害。
  reset(time = 0) {
    this.state = 'ready';
    this.nextFireAt = time;
    this.reloadEnd = 0;
  }
}

export function computeShotDamage(def, { headshot = false, dist = 0 }) {
  const base = damageFalloffSafe(def, dist);
  const mult = headshot ? def.headshotMult : 1;
  return Math.max(1, Math.round(base * mult));
}

function damageFalloffSafe(def, dist) {
  if (def.melee) return def.damage;
  const near = def.falloffNear ?? 15;
  const far = def.falloffFar ?? 60;
  const min = def.falloffMin ?? 0.45;
  if (dist <= near) return def.damage;
  if (dist >= far) return def.damage * min;
  const t = (dist - near) / (far - near);
  return def.damage * (1 - t * (1 - min));
}

export function applySpread(def, ads, rng = Math.random) {
  const max = ads ? def.adsSpread : def.spread;
  return rng() * max;
}

// 半自动武器只在“松开→按下”的边沿开火；全自动/近战按住即连发。
export function shouldFire(def, held, wasHeld) {
  if (!held) return false;
  if (def?.auto || def?.melee) return true;
  return !wasHeld;
}
