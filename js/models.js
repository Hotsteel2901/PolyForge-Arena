// 程序化建模：玩家、第一人称枪械、道具、炸弹、弹药箱、贴图。零外部资产。

import * as THREE from 'three';

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = `${color}|${opts.metalness ?? 0.2}|${opts.roughness ?? 0.75}|${opts.emissive ?? 0}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color,
      metalness: opts.metalness ?? 0.2,
      roughness: opts.roughness ?? 0.75,
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 1,
    }));
  }
  return matCache.get(key);
}

function add(parent, geo, material, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// ---------------- 玩家模型 ----------------
export function buildPlayer({ zombie = false, team = 1 } = {}) {
  const root = new THREE.Group();
  const skin = zombie ? 0x9dbd6c : 0xd8a06a;
  const suit = zombie ? 0x55702f : team === 1 ? 0x2468c8 : 0xe04a1f;
  const trim = zombie ? 0x8fbf5a : team === 1 ? 0xa9d6ff : 0xffc46b;
  const dark = zombie ? 0x3d5228 : 0x26303a;
  const leg = add(root, B(0.17, 0.45, 0.17), mat(dark), zombie ? 0 : 0.11, 0.225, 0);
  add(root, B(0.17, 0.45, 0.17), mat(dark), zombie ? 0 : -0.11, 0.225, 0);
  const torso = add(root, B(0.44, 0.52, 0.25), mat(suit), 0, zombie ? 0.66 : 0.72, 0);
  if (zombie) {
    torso.rotation.z = 0.08;
    torso.rotation.x = 0.18;
  }
  // 护甲/口袋细节
  add(root, B(0.46, 0.2, 0.28), mat(dark, { roughness: 0.6 }), 0, 0.56, 0);
  add(root, B(0.2, 0.1, 0.3), mat(dark), 0, 0.78, 0);
  const head = add(root, new THREE.SphereGeometry(0.17, 12, 10), mat(skin), 0, zombie ? 1.12 : 1.3, 0);
  add(root, new THREE.SphereGeometry(0.185, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(zombie ? 0x4d6630 : 0x1d2731), 0, zombie ? 1.13 : 1.31, 0);
  // 亮色头带 + 肩甲，一眼区分阵营
  if (!zombie) {
    add(root, B(0.19, 0.06, 0.19), mat(trim, { roughness: 0.5 }), 0, 1.22, 0);
    add(root, B(0.16, 0.09, 0.15), mat(trim, { roughness: 0.55 }), -0.27, 0.94, 0);
    add(root, B(0.16, 0.09, 0.15), mat(trim, { roughness: 0.55 }), 0.27, 0.94, 0);
  }
  if (zombie) {
    const eye = new THREE.MeshStandardMaterial({ color: 0xff2a1a, emissive: 0xff2a1a, emissiveIntensity: 2.4 });
    add(head, new THREE.SphereGeometry(0.028, 6, 6), eye, 0.06, 0.03, 0.14);
    add(head, new THREE.SphereGeometry(0.028, 6, 6), eye, -0.06, 0.03, 0.14);
  }
  // 手臂
  const armL = add(root, B(0.13, 0.42, 0.13), mat(suit), zombie ? 0.1 : -0.3, 0.78, 0);
  const armR = add(root, B(0.13, 0.42, 0.13), mat(suit), 0.3, 0.78, 0);
  if (zombie) {
    armL.rotation.x = -1.25;
    armR.rotation.x = -1.25;
    const clawMat = mat(0xe8e0d0, { roughness: 0.5 });
    for (const side of [-1, 1]) {
      for (let i = -1; i <= 1; i++) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.12, 5), clawMat);
        claw.position.set(side * 0.3 + i * 0.045, 0.5, 0.3);
        claw.rotation.x = 1.35;
        claw.rotation.z = i * 0.18;
        root.add(claw);
      }
    }
  } else {
    const gun = add(root, B(0.07, 0.09, 0.42), mat(0x2a2e34, { metalness: 0.6, roughness: 0.4 }), 0.3, 0.7, 0.18);
    gun.rotation.x = 0.08;
  }
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
    }
  });
  root.userData.parts = { armL, armR, leg };
  return root;
}

// ---------------- 第一人称枪械 ----------------
export function buildViewmodel(id) {
  const g = new THREE.Group();
  const metal = mat(0x454b52, { metalness: 0.75, roughness: 0.35 });
  const dark = mat(0x26292e, { metalness: 0.5, roughness: 0.55 });
  const grip = mat(0x241d16, { roughness: 0.9 });
  const accent = mat(0x7d3f24, { metalness: 0.4, roughness: 0.55 });
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -0.52);

  switch (id) {
    case 'k9': {
      add(g, B(0.08, 0.11, 0.24), metal, 0, 0, 0);
      add(g, new THREE.CylinderGeometry(0.028, 0.028, 0.14, 10), dark, 0, 0.03, -0.18, Math.PI / 2, 0, 0);
      add(g, B(0.09, 0.14, 0.05), grip, 0.005, -0.12, 0.06, 0.22);
      add(g, B(0.09, 0.05, 0.12), dark, 0, 0.07, 0.12);
      add(g, B(0.03, 0.03, 0.03), metal, 0, 0.04, 0.16);
      muzzle.position.z = -0.3;
      break;
    }
    case 'vx9': {
      add(g, B(0.09, 0.13, 0.36), metal, 0, 0.01, 0.04);
      add(g, B(0.07, 0.09, 0.2), dark, 0, 0.01, -0.22);
      add(g, new THREE.CylinderGeometry(0.025, 0.025, 0.22, 10), dark, 0, 0.01, -0.34, Math.PI / 2, 0, 0);
      add(g, B(0.08, 0.17, 0.07), grip, 0, -0.13, 0.13, -0.16);
      add(g, B(0.08, 0.18, 0.06), grip, 0, -0.13, -0.05, -0.18);
      add(g, B(0.09, 0.12, 0.14), dark, 0, -0.07, 0.14, 0.14);
      add(g, B(0.05, 0.05, 0.06), accent, 0, 0.06, 0.2);
      muzzle.position.z = -0.46;
      break;
    }
    case 'arc17': {
      add(g, B(0.09, 0.14, 0.4), metal, 0, 0.02, 0.02);
      add(g, B(0.08, 0.1, 0.18), dark, 0, 0.02, -0.26);
      add(g, new THREE.CylinderGeometry(0.022, 0.022, 0.24, 10), dark, 0, 0.03, -0.38, Math.PI / 2, 0, 0);
      add(g, B(0.09, 0.16, 0.07), grip, 0, -0.14, 0.1, -0.14);
      add(g, B(0.08, 0.2, 0.06), grip, 0, -0.16, -0.12, -0.14);
      add(g, B(0.08, 0.1, 0.08), grip, 0, -0.12, 0.2, 0.18);
      add(g, B(0.1, 0.08, 0.14), dark, 0, 0.02, -0.14);
      add(g, B(0.05, 0.09, 0.08), dark, 0, 0.06, 0.16);
      add(g, B(0.03, 0.02, 0.03), mat(0x33dd66, { emissive: 0x33dd66, emissiveIntensity: 2 }), 0, 0.085, 0.19);
      muzzle.position.z = -0.52;
      break;
    }
    case 'warden': {
      add(g, B(0.1, 0.13, 0.34), metal, 0, 0.02, 0.02);
      add(g, B(0.08, 0.09, 0.3), accent, 0, 0, -0.28);
      add(g, new THREE.CylinderGeometry(0.026, 0.026, 0.36, 10), dark, 0, 0.03, -0.34, Math.PI / 2, 0, 0);
      add(g, B(0.09, 0.17, 0.07), grip, 0, -0.14, 0.1, -0.14);
      add(g, B(0.09, 0.16, 0.05), grip, 0, -0.15, -0.18, -0.14);
      add(g, B(0.07, 0.11, 0.08), dark, 0, -0.06, 0.16, 0.16);
      add(g, B(0.04, 0.04, 0.2), metal, 0, 0.055, -0.16);
      muzzle.position.z = -0.54;
      break;
    }
    case 'longshot': {
      add(g, B(0.08, 0.13, 0.36), metal, 0, 0.02, 0.05);
      add(g, new THREE.CylinderGeometry(0.02, 0.02, 0.62, 10), dark, 0, 0.03, -0.42, Math.PI / 2, 0, 0);
      add(g, new THREE.CylinderGeometry(0.032, 0.032, 0.2, 10), metal, 0, 0.08, 0, Math.PI / 2, 0, 0);
      add(g, new THREE.SphereGeometry(0.035, 10, 8), mat(0x9fd8ff, { metalness: 0.1, roughness: 0.1 }), 0, 0.08, -0.05);
      add(g, B(0.08, 0.16, 0.07), grip, 0, -0.14, 0.12, -0.16);
      add(g, B(0.07, 0.12, 0.08), grip, 0, -0.13, -0.18, -0.12);
      muzzle.position.z = -0.74;
      break;
    }
    case 'bruiser': {
      add(g, B(0.1, 0.15, 0.42), metal, 0, 0.02, 0.02);
      add(g, B(0.09, 0.1, 0.16), dark, 0, 0.02, -0.26);
      add(g, new THREE.CylinderGeometry(0.022, 0.022, 0.24, 10), dark, 0, 0.04, -0.38, Math.PI / 2, 0, 0);
      add(g, new THREE.CylinderGeometry(0.065, 0.065, 0.09, 12), mat(0x8a6a3a), 0, -0.08, 0.04, Math.PI / 2, 0, 0);
      add(g, B(0.09, 0.17, 0.07), grip, 0, -0.14, 0.1, -0.14);
      add(g, B(0.07, 0.08, 0.16), dark, 0, 0.02, -0.06);
      muzzle.position.z = -0.52;
      break;
    }
    case 'fang': {
      add(g, new THREE.CylinderGeometry(0.018, 0.03, 0.26, 8), metal, 0, 0.03, -0.18, Math.PI / 2, 0, 0);
      add(g, new THREE.ConeGeometry(0.018, 0.1, 8), metal, 0, 0.03, -0.34, Math.PI / 2, 0, 0);
      add(g, B(0.05, 0.03, 0.09), metal, 0, 0.03, -0.02);
      add(g, B(0.04, 0.11, 0.11), grip, 0, -0.06, 0.05, 0.12);
      muzzle.position.z = -0.38;
      break;
    }
    case 'thunder': {
      add(g, new THREE.SphereGeometry(0.075, 14, 10), mat(0x5c6b3a, { roughness: 0.5 }), 0, 0, -0.12);
      add(g, B(0.04, 0.03, 0.05), metal, 0, 0.05, -0.05);
      add(g, new THREE.TorusGeometry(0.025, 0.008, 6, 10), metal, 0, 0.02, -0.19);
      muzzle.position.z = -0.2;
      break;
    }
    case 'zclaw': {
      const clawMat = mat(0xd8d0c0, { roughness: 0.45 });
      for (let i = -1; i <= 1; i++) {
        add(g, new THREE.ConeGeometry(0.02, 0.24, 6), clawMat, i * 0.045, -0.02, -0.22, 1.1, 0, i * 0.12);
      }
      add(g, B(0.12, 0.13, 0.12), mat(0x4d6630), 0, 0, 0);
      muzzle.position.z = -0.26;
      break;
    }
    case 'cryo_gun': {
      const ice = mat(0x9fd8ff, { metalness: 0.6, roughness: 0.3 });
      add(g, B(0.08, 0.13, 0.34), ice, 0, 0.01, 0.03);
      add(g, B(0.07, 0.09, 0.16), dark, 0, 0.01, -0.24);
      add(g, new THREE.CylinderGeometry(0.02, 0.02, 0.26, 10), mat(0xbfe9ff), 0, 0.02, -0.38, Math.PI / 2, 0, 0);
      add(g, B(0.08, 0.17, 0.07), grip, 0, -0.13, 0.11, -0.14);
      add(g, B(0.08, 0.2, 0.06), grip, 0, -0.15, -0.1, -0.14);
      add(g, B(0.04, 0.06, 0.12), mat(0x55c8ff, { emissive: 0x33aaff, emissiveIntensity: 2.2 }), 0, 0.05, 0.17);
      muzzle.position.z = -0.52;
      break;
    }
    case 'railgun': {
      const coil = mat(0xff9d4d, { emissive: 0xff7b2a, emissiveIntensity: 2 });
      add(g, B(0.09, 0.14, 0.46), metal, 0, 0.02, 0.04);
      add(g, B(0.07, 0.09, 0.3), dark, 0, 0.02, -0.34);
      add(g, new THREE.CylinderGeometry(0.018, 0.018, 0.5, 10), mat(0x22262a), 0, 0.03, -0.5, Math.PI / 2, 0, 0);
      add(g, new THREE.TorusGeometry(0.035, 0.012, 8, 12), coil, 0, 0.07, -0.1);
      add(g, B(0.09, 0.16, 0.07), grip, 0, -0.14, 0.12, -0.16);
      add(g, B(0.08, 0.2, 0.06), grip, 0, -0.16, -0.16, -0.14);
      add(g, new THREE.SphereGeometry(0.03, 10, 8), mat(0xffb36b, { emissive: 0xff7b2a, emissiveIntensity: 2 }), 0, 0.02, 0.2);
      muzzle.position.z = -0.62;
      break;
    }
    case 'energy_rifle': {
      const glow = mat(0x39d2ff, { emissive: 0x1fb8ff, emissiveIntensity: 2.2 });
      const panel = mat(0x21303a, { metalness: 0.5, roughness: 0.5 });
      add(g, B(0.09, 0.14, 0.4), metal, 0, 0.02, 0.02);
      add(g, B(0.08, 0.1, 0.2), panel, 0, 0.02, -0.26);
      add(g, new THREE.CylinderGeometry(0.022, 0.022, 0.3, 10), dark, 0, 0.03, -0.42, Math.PI / 2, 0, 0);
      add(g, B(0.09, 0.16, 0.07), grip, 0, -0.14, 0.1, -0.14);
      add(g, B(0.08, 0.2, 0.06), grip, 0, -0.16, -0.12, -0.14);
      add(g, B(0.1, 0.06, 0.2), panel, 0, 0.05, -0.18);
      add(g, B(0.06, 0.05, 0.16), glow, 0, 0.065, -0.22);
      add(g, new THREE.TorusGeometry(0.02, 0.008, 8, 10), glow, 0, 0.07, -0.4);
      add(g, B(0.04, 0.02, 0.03), glow, 0, 0.09, 0.14);
      muzzle.position.z = -0.56;
      break;
    }
    default:
      add(g, B(0.08, 0.12, 0.3), dark, 0, 0, 0);
  }
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  return g;
}

// ---------------- 道具 ----------------
export function buildCrate(c, size) {
  const w = Math.max(0.05, c.max.x - c.min.x);
  const h = Math.max(0.05, c.max.y - c.min.y);
  const d = Math.max(0.05, c.max.z - c.min.z);
  const hash = Math.floor((c.min.x * 7 + c.min.z * 13) % 3);
  const colors = [0x8a6f3f, 0x6f5a3a, 0x7c6a4a];
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color: colors[hash], roughness: 0.85 })
  );
  m.position.set((c.min.x + c.max.x) / 2, (c.min.y + c.max.y) / 2, (c.min.z + c.max.z) / 2);
  m.castShadow = true;
  m.receiveShadow = true;
  // 边框线
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(m.geometry),
    new THREE.LineBasicMaterial({ color: 0x1c140a, transparent: true, opacity: 0.6 })
  );
  m.add(edges);
  return m;
}

export function buildBarrel(c) {
  const h = Math.max(0.1, c.max.y - c.min.y);
  const r = Math.max(0.3, (c.max.x - c.min.x) / 2);
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, h, 14),
    new THREE.MeshStandardMaterial({ color: 0x7c8a5a, roughness: 0.5, metalness: 0.35 })
  );
  body.position.y = h / 2;
  body.castShadow = true;
  g.add(body);
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.94, r * 0.94, 0.06, 14),
    new THREE.MeshStandardMaterial({ color: 0x4a5540, roughness: 0.6 })
  );
  top.position.y = h + 0.02;
  g.add(top);
  g.position.set((c.min.x + c.max.x) / 2, 0, (c.min.z + c.max.z) / 2);
  return g;
}

export function buildPillar(c) {
  const h = Math.max(0.1, c.max.y - c.min.y);
  const r = Math.max(0.3, (c.max.x - c.min.x) / 2);
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.88, r, h, 12),
    new THREE.MeshStandardMaterial({ color: 0xb8c2b8, roughness: 0.55, metalness: 0.2 })
  );
  m.position.set((c.min.x + c.max.x) / 2, h / 2, (c.min.z + c.max.z) / 2);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function buildBomb() {
  const g = new THREE.Group();
  add(g, B(0.36, 0.16, 0.22), mat(0x37413a, { metalness: 0.5, roughness: 0.5 }), 0, 0.1, 0);
  add(g, new THREE.CylinderGeometry(0.03, 0.03, 0.18, 8), mat(0x9aa5a0), 0, 0.22, -0.04);
  const light = add(g, new THREE.SphereGeometry(0.035, 8, 8), mat(0xff2020, { emissive: 0xff2020, emissiveIntensity: 2.5 }), 0.12, 0.18, 0.06);
  g.userData.light = light;
  g.userData.blink = 0;
  return g;
}

export function buildAmmoBox() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.5, 0.6),
    new THREE.MeshStandardMaterial({ color: 0xd9a92f, roughness: 0.6, emissive: 0x6b4d00, emissiveIntensity: 0.35 })
  );
  m.position.y = 0.25;
  m.castShadow = true;
  g.add(m);
  const cross = add(g, B(0.28, 0.12, 0.03), mat(0x222), 0, 0.3, 0.32);
  add(g, B(0.12, 0.28, 0.03), mat(0x222), 0, 0.3, 0.32);
  g.userData.pulse = cross;
  return g;
}

export function buildSiteRing(color, radius = 2.6) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.3, radius, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  g.add(ring);
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, depthWrite: false })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.04;
  g.add(glow);
  return g;
}

export function buildLightGlow(color) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,230,0.95)');
  g.addColorStop(0.4, 'rgba(255,240,180,0.35)');
  g.addColorStop(1, 'rgba(255,240,180,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false }));
  sprite.scale.set(3, 3, 1);
  return sprite;
}

// 玩家头顶名牌 + 血条（Canvas 贴图，血量变化时重绘）；carrier=true 时绘制炸弹携带标记
export function buildNameTag(name, hp, maxHp, zombie = false, team = 0, carrier = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  sprite.scale.set(1.9, 0.7, 1);
  sprite.userData = { name, hp, maxHp, zombie, team, carrier, redraw() {
    ctx.clearRect(0, 0, 256, 96);
    const d = sprite.userData;
    if (d.carrier) {
      // 炸弹图标：红色圆 + 灰色引信 + 黄圈
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(126, 4, 4, 7);
      ctx.fillStyle = '#ff3b30';
      ctx.beginPath(); ctx.arc(128, 18, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(128, 18, 10, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,.85)';
    ctx.strokeText(d.name, 128, 42);
    ctx.fillStyle = d.zombie ? '#ffb0a0' : d.team === 1 ? '#cfe4ff' : d.team === 2 ? '#ffe0c2' : '#e8f2ea';
    ctx.fillText(d.name, 128, 42);
    const w = 180, h = 13, x = 38, y = 60;
    ctx.fillStyle = 'rgba(0,0,0,.65)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    const pct = Math.max(0, Math.min(1, d.hp / Math.max(1, d.maxHp)));
    ctx.fillStyle = d.zombie ? '#e74c3c' : d.team === 1 ? '#3d9bff' : d.team === 2 ? '#ffa13d' : '#3ddc63';
    ctx.fillRect(x, y, w * pct, h);
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.strokeRect(x, y, w, h);
    tex.needsUpdate = true;
  } };
  sprite.userData.redraw();
  return sprite;
}
