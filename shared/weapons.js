// 数据驱动武器（极致细分版）：每把枪拥有独特的定位、射速、后坐力曲线、穿甲、移速、爆头倍率与衰减特性。

export const BUILTIN_WEAPONS = Object.freeze({
  fang: {
    id: 'fang',
    name: 'Fang 战术爪刃',
    role: '近战刺杀 · 极速机动',
    slot: 0,
    auto: true,
    melee: true,
    range: 2.6,
    fireRate: 185,
    damage: 48,
    headshotMult: 2.2,
    pellets: 1,
    magSize: Infinity,
    reserve: Infinity,
    reloadTime: 0,
    spread: 0,
    adsSpread: 0,
    recoil: 0.008,
    moveMult: 1.12,
    falloffNear: 1.8,
    falloffFar: 2.6,
    falloffMin: 0.95,
    sound: 'melee',
  },
  k9: {
    id: 'k9',
    name: 'K9 战术手枪',
    role: '精准点射 · 极速换弹',
    slot: 1,
    auto: false,
    fireRate: 340,
    damage: 34,
    headshotMult: 2.1,
    armorPen: 0.55,
    pellets: 1,
    magSize: 14,
    reserve: 56,
    reloadTime: 1.25,
    spread: 0.022,
    adsSpread: 0.005,
    recoil: 0.022,
    moveMult: 1.04,
    falloffNear: 16,
    falloffFar: 58,
    falloffMin: 0.52,
    sound: 'pistol',
  },
  vx9: {
    id: 'vx9',
    name: 'VX9 极速冲锋枪',
    role: '高射速跑打 · 近战缠斗',
    slot: 2,
    auto: true,
    fireRate: 960,
    damage: 19,
    headshotMult: 1.75,
    armorPen: 0.45,
    pellets: 1,
    magSize: 34,
    reserve: 136,
    reloadTime: 1.75,
    spread: 0.036,
    adsSpread: 0.011,
    recoil: 0.014,
    moveMult: 1.04,
    falloffNear: 11,
    falloffFar: 42,
    falloffMin: 0.38,
    sound: 'smg',
  },
  arc17: {
    id: 'arc17',
    name: 'ARC-17 突击步枪',
    role: '中远全能 · 精准控枪',
    slot: 2,
    auto: true,
    fireRate: 660,
    damage: 30,
    headshotMult: 2.0,
    armorPen: 0.72,
    pellets: 1,
    magSize: 30,
    reserve: 120,
    reloadTime: 2.1,
    spread: 0.030,
    adsSpread: 0.006,
    recoil: 0.019,
    moveMult: 0.92,
    falloffNear: 20,
    falloffFar: 74,
    falloffMin: 0.55,
    sound: 'rifle',
  },
  warden: {
    id: 'warden',
    name: 'Warden 破门霰弹',
    role: '10弹丸爆发 · 贴脸清场',
    slot: 2,
    auto: false,
    fireRate: 92,
    damage: 13,
    headshotMult: 1.5,
    armorPen: 0.5,
    pellets: 10,
    magSize: 8,
    reserve: 40,
    reloadTime: 2.55,
    spread: 0.088,
    adsSpread: 0.042,
    recoil: 0.062,
    moveMult: 0.88,
    falloffNear: 9,
    falloffFar: 26,
    falloffMin: 0.28,
    sound: 'shotgun',
  },
  longshot: {
    id: 'longshot',
    name: 'Longshot 反器材狙击',
    role: '高倍穿甲 · 一击必杀',
    slot: 2,
    auto: false,
    fireRate: 48,
    damage: 128,
    headshotMult: 2.6,
    armorPen: 0.92,
    pellets: 1,
    magSize: 5,
    reserve: 25,
    reloadTime: 3.0,
    spread: 0.022,
    adsSpread: 0.0006,
    recoil: 0.092,
    moveMult: 0.78,
    falloffNear: 45,
    falloffFar: 240,
    falloffMin: 0.85,
    sound: 'sniper',
  },
  bruiser: {
    id: 'bruiser',
    name: 'Bruiser 压制轻机枪',
    role: '120发弹鼓 · 越打越稳',
    slot: 2,
    auto: true,
    fireRate: 760,
    damage: 25,
    headshotMult: 1.65,
    armorPen: 0.75,
    pellets: 1,
    magSize: 120,
    reserve: 240,
    reloadTime: 3.8,
    spread: 0.048,
    adsSpread: 0.014,
    recoil: 0.020,
    moveMult: 0.80,
    falloffNear: 16,
    falloffFar: 64,
    falloffMin: 0.48,
    sound: 'lmg',
  },
  thunder: {
    id: 'thunder',
    name: 'Thunder 高爆破片雷',
    role: '范围破片 · 逼位清点',
    slot: 3,
    auto: false,
    projectile: 'grenade',
    fireRate: 55,
    damage: 185,
    headshotMult: 1,
    pellets: 1,
    magSize: 99,
    reserve: 0,
    reloadTime: 1,
    spread: 0,
    adsSpread: 0,
    recoil: 0,
    moveMult: 1.02,
    falloffNear: 3.5,
    falloffFar: 12,
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
    this.state = 'ready';
    this.nextFireAt = 0;
    this.reloadEnd = 0;
    this.sustainedShots = 0;
    this.lastShotAt = -10;
  }

  get interval() {
    return 60 / Math.max(1, this.def.fireRate);
  }

  canFire(time) {
    return this.state === 'ready' && this.ammo > 0 && time >= this.nextFireAt;
  }

  fire(time) {
    if (!this.canFire(time)) return { ok: false };
    if (time - this.lastShotAt < 0.35) this.sustainedShots = Math.min(24, this.sustainedShots + 1);
    else this.sustainedShots = 1;
    this.lastShotAt = time;
    this.ammo -= 1;
    this.nextFireAt = time + this.interval;
    if (this.ammo === 0) this.state = 'empty';
    return { ok: true, ammo: this.ammo, sustained: this.sustainedShots };
  }

  startReload(time) {
    if (this.state === 'reloading' || this.reserve <= 0 || this.ammo === this.def.magSize) {
      return { ok: false };
    }
    this.state = 'reloading';
    this.reloadEnd = time + this.def.reloadTime;
    this.sustainedShots = 0;
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

  reset(time = 0) {
    this.state = 'ready';
    this.nextFireAt = time;
    this.reloadEnd = 0;
    this.sustainedShots = 0;
    this.lastShotAt = -10;
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

export function applySpread(def, ads, rng = Math.random, sustained = 0) {
  let max = ads ? def.adsSpread : def.spread;
  // Bruiser 轻机枪专属特性：连续射击超过 5 发后散布收束（越打越稳）
  if (def?.id === 'bruiser' && sustained > 5) {
    max *= Math.max(0.45, 1 - (sustained - 5) * 0.04);
  }
  return rng() * max;
}

export function shouldFire(def, held, wasHeld) {
  if (!held) return false;
  if (def?.auto || def?.melee) return true;
  return !wasHeld;
}
