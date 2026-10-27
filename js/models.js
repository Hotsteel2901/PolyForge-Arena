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
// 结构：root(脚底) → 腿组(髋部为轴) / 躯干组 / 手臂组(肩部为轴) / 头部组(颈部为轴)
// 每个可动部位都是独立 Group，动画只需改 group.rotation，不需要重建几何。
// 站立总高约 1.78m，与 PHYS.STAND_H=1.8 对齐（下蹲时由客户端整体 squash 到 1.2m）。
export function buildPlayer({ zombie = false, team = 1 } = {}) {
  const root = new THREE.Group();
  const skin = zombie ? 0x93a86b : 0xd8a06a;
  const suit = zombie ? 0x4c6330 : team === 1 ? 0x1f5aa0 : 0x9c3a1d;
  const suitDark = zombie ? 0x37491f : team === 1 ? 0x173f70 : 0x6d2814;
  const trim = zombie ? 0x8fbf5a : team === 1 ? 0x8fd6ff : 0xffb066;
  const dark = zombie ? 0x2f3d1e : 0x232a32;
  const parts = {};

  const legGeo = { thigh: B(0.16, 0.42, 0.18), shin: B(0.14, 0.38, 0.16), boot: B(0.16, 0.12, 0.26) };
  for (const [side, key] of [[-1, 'legL'], [1, 'legR']]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.115, 0.86, 0);
    add(leg, legGeo.thigh, mat(suitDark), 0, -0.21, 0);
    add(leg, legGeo.shin, mat(suit), 0, -0.60, 0);
    add(leg, legGeo.boot, mat(dark), 0, -0.82, -0.03);
    // 护膝
    add(leg, B(0.15, 0.09, 0.15), mat(trim, { roughness: 0.5 }), 0, -0.40, 0.02);
    root.add(leg);
    parts[key] = leg;
  }

  const torso = new THREE.Group();
  torso.position.set(0, 0.86, 0);
  add(torso, B(0.42, 0.48, 0.24), mat(suit), 0, 0.24, 0);
  // 战术背心 + 弹匣袋
  add(torso, B(0.44, 0.30, 0.27), mat(suitDark, { roughness: 0.65 }), 0, 0.28, 0.005);
  add(torso, B(0.30, 0.10, 0.06), mat(dark), 0, 0.22, 0.15);
  add(torso, B(0.10, 0.10, 0.05), mat(trim, { roughness: 0.5 }), -0.12, 0.36, 0.15);
  add(torso, B(0.42, 0.06, 0.25), mat(dark), 0, 0.03, 0);
  // 背包
  add(torso, B(0.28, 0.30, 0.15), mat(dark, { roughness: 0.7 }), 0, 0.26, -0.19);
  add(torso, B(0.06, 0.34, 0.02), mat(trim, { roughness: 0.5 }), 0, 0.26, -0.27);
  // 颈部
  add(torso, new THREE.CylinderGeometry(0.055, 0.06, 0.09, 8), mat(skin), 0, 0.50, 0);
  root.add(torso);
  parts.torso = torso;

  const head = new THREE.Group();
  head.position.set(0, 1.36, 0);
  add(head, new THREE.SphereGeometry(0.155, 14, 12), mat(skin), 0, 0.13, 0);
  // 头盔：半球壳 + 前沿
  add(head, new THREE.SphereGeometry(0.175, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), mat(zombie ? 0x3b4a26 : suitDark, { roughness: 0.55 }), 0, 0.14, 0);
  // 面罩 / 护目镜
  add(head, B(0.26, 0.075, 0.04), mat(zombie ? 0x241c10 : 0x101820, { metalness: 0.6, roughness: 0.25 }), 0, 0.14, 0.16);
  add(head, B(0.24, 0.05, 0.05), mat(skin), 0, 0.05, 0.14);
  if (zombie) {
    const eye = new THREE.MeshStandardMaterial({ color: 0xff3a20, emissive: 0xff2a10, emissiveIntensity: 2.6 });
    add(head, new THREE.SphereGeometry(0.026, 6, 6), eye, 0.06, 0.155, 0.165);
    add(head, new THREE.SphereGeometry(0.026, 6, 6), eye, -0.06, 0.155, 0.165);
    // 撕裂的布条
    add(head, B(0.2, 0.06, 0.06), mat(0x6a2a22, { roughness: 0.9 }), 0, -0.02, 0.1);
  } else {
    // 队伍识别：头盔侧徽
    add(head, B(0.04, 0.06, 0.10), mat(trim, { roughness: 0.45 }), 0.16, 0.16, 0);
    add(head, B(0.04, 0.06, 0.10), mat(trim, { roughness: 0.45 }), -0.16, 0.16, 0);
  }
  root.add(head);
  parts.head = head;

  const gunMat = mat(0x4a525c, { metalness: 0.4, roughness: 0.45 });
  for (const [side, key] of [[-1, 'armL'], [1, 'armR']]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.255, 1.28, 0);
    add(arm, B(0.12, 0.26, 0.13), mat(suit), 0, -0.13, 0);
    add(arm, B(0.11, 0.24, 0.12), mat(suitDark), 0, -0.36, 0);
    add(arm, B(0.10, 0.10, 0.11), mat(skin), 0, -0.50, 0);
    // 肩甲
    add(arm, B(0.15, 0.09, 0.17), mat(trim, { roughness: 0.5 }), side * 0.02, 0.02, 0);
    root.add(arm);
    parts[key] = arm;
  }

  if (zombie) {
    const clawMat = mat(0xe8e0d0, { roughness: 0.5 });
    for (const key of ['armL', 'armR']) {
      const arm = parts[key];
      const side = key === 'armR' ? 1 : -1;
      for (let i = -1; i <= 1; i++) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.017, 0.13, 5), clawMat);
        claw.position.set(i * 0.038, -0.58, 0.02);
        claw.rotation.x = Math.PI * 0.92;
        claw.rotation.z = i * 0.16;
        arm.add(claw);
      }
      arm.userData.side = side;
    }
    // 丧尸：前倾含胸、双臂前伸下垂
    torso.rotation.x = 0.16;
    parts.armL.rotation.x = -1.32;
    parts.armR.rotation.x = -1.36;
    parts.armL.rotation.z = 0.07;
    parts.armR.rotation.z = -0.07;
    head.rotation.x = 0.12;
  } else {
    // 人类：双手持枪姿态（左手上护木、右手握把），枪挂在躯干上随身体移动
    parts.armR.rotation.x = -1.28;
    parts.armR.rotation.z = -0.12;
    parts.armL.rotation.x = -1.34;
    parts.armL.rotation.z = 0.30;
    const gun = new THREE.Group();
    gun.position.set(0.06, 1.16, 0.30);
    add(gun, B(0.07, 0.09, 0.46), gunMat, 0, 0, 0);
    add(gun, B(0.05, 0.14, 0.10), mat(0x1b2026), 0, -0.07, 0.06);
    add(gun, B(0.04, 0.10, 0.09), mat(0x1b2026), 0, -0.05, -0.16);
    add(gun, new THREE.CylinderGeometry(0.017, 0.017, 0.16, 8), gunMat, 0, 0.01, -0.30, Math.PI / 2, 0, 0);
    root.add(gun);
    parts.gun = gun;
  }

  root.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  root.userData.parts = parts;
  root.userData.zombie = zombie;
  return root;
}

// ---------------- 第一人称枪械 ----------------
export function buildViewmodel(id) {
  const g = new THREE.Group();
  // 金属件不要把 metalness 拉满：没有环境贴图的设备上（低端 GPU / 关闭画质）
  // 纯金属材质只剩镜面反射，会渲染成一块死黑，枪在手里完全看不出结构。
  const metal = mat(0x707a86, { metalness: 0.45, roughness: 0.42 });
  const dark = mat(0x3b424b, { metalness: 0.3, roughness: 0.6 });
  const grip = mat(0x3a2c20, { metalness: 0.1, roughness: 0.85 });
  const accent = mat(0x8f4a28, { metalness: 0.3, roughness: 0.55 });
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
      // Fang 匕首：握柄 → 护手 → 渐宽刀身 → 尖锋。刀身略向上倾，符合持握姿态。
      const blade = mat(0xb9c4cc, { metalness: 0.9, roughness: 0.22 });
      const edge = mat(0xe8f2f8, { metalness: 0.95, roughness: 0.12 });
      // 握柄
      add(g, B(0.042, 0.05, 0.13), grip, 0, 0.02, 0.07);
      // 护手
      add(g, B(0.10, 0.022, 0.025), dark, 0, 0.025, -0.005);
      // 刀身主体（扁平、略上翘）
      add(g, B(0.032, 0.052, 0.24), blade, 0, 0.042, -0.14, -0.06);
      // 刀锋亮边
      add(g, B(0.008, 0.056, 0.24), edge, 0.017, 0.042, -0.14, -0.06);
      // 刀尖
      add(g, new THREE.ConeGeometry(0.028, 0.11, 4), blade, 0, 0.052, -0.3, -Math.PI / 2 - 0.08, Math.PI / 4, 0);
      // 刀背凸起
      add(g, B(0.036, 0.016, 0.1), dark, 0, 0.068, -0.1, -0.06);
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
      // 尸爪：三根外张的利爪 + 掌部 + 腕部，爪尖偏暖白，掌部偏腐绿。
      const clawMat = mat(0xe4dccb, { roughness: 0.35, metalness: 0.1 });
      const flesh = mat(0x5d7434, { roughness: 0.85 });
      const wound = mat(0x8a3f3f, { roughness: 0.7 });
      // 掌部
      add(g, B(0.13, 0.14, 0.13), flesh, 0, 0, 0.01);
      // 腕部
      add(g, B(0.09, 0.10, 0.14), flesh, 0, -0.005, 0.12);
      // 三根爪：根粗尖细，向前并向外张开
      for (let i = -1; i <= 1; i++) {
        const outward = i * 0.055;
        // 指节
        add(g, B(0.034, 0.05, 0.07), flesh, outward, -0.012, -0.058, 0.15, i * 0.1, 0);
        // 爪身
        add(g, new THREE.ConeGeometry(0.021, 0.26, 6), clawMat, outward * 1.55, -0.005, -0.21, 1.28, i * 0.16, i * 0.14);
      }
      // 掌心血痕
      add(g, B(0.05, 0.012, 0.05), wound, 0, 0.072, 0.0);
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
  addHands(g, id);
  g.add(muzzle);
  // 第一人称模型不参与阴影：它离相机只有 0.5m，而阴影贴图覆盖整张地图（2048 覆盖 100m，
  // 每 texel 约 5cm），自阴影 acne 会把整把枪压成一块纯黑剪影。
  // 第一人称材质微调：金属件压低 metalness + 给一点自发光。
  // 枪身与相机只隔 0.4m，场景光的入射角几乎全是掠射，纯 PBR 金属会整块发黑；
  // 少量自发光（基础色的 30%）保证任何光照下都能看清结构与手部。
  const remap = new Map();
  g.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = false;
    let m = remap.get(o.material);
    if (!m) {
      m = o.material.clone();
      if (m.emissive) {
        m.emissive = new THREE.Color(m.color).multiplyScalar(0.3);
        m.emissiveIntensity = 1;
      }
      if (m.metalness !== undefined) m.metalness = Math.min(m.metalness, 0.3);
      if (m.roughness !== undefined) m.roughness = Math.max(m.roughness, 0.45);
      m.needsUpdate = true;
      remap.set(o.material, m);
    }
    o.material = m;
  });
  g.userData.muzzle = muzzle;
  return g;
}

// 第一人称手部：只做"握把 + 前护木"两只手 + 一段袖口。
// 没有手的枪看起来像"浮在空中的模型"，这是第一人称最容易出戏的地方。
const HAND_POS = {
  k9: { grip: [0.005, -0.11, 0.06], fore: [-0.045, -0.095, 0.03] },
  vx9: { grip: [0, -0.115, 0.13], fore: [-0.02, -0.07, -0.09] },
  arc17: { grip: [0, -0.12, 0.10], fore: [-0.02, -0.05, -0.15] },
  warden: { grip: [0, -0.12, 0.10], fore: [-0.02, -0.04, -0.21] },
  longshot: { grip: [0, -0.12, 0.12], fore: [-0.02, -0.06, -0.16] },
  bruiser: { grip: [0, -0.12, 0.10], fore: [-0.02, -0.05, -0.12] },
  cryo_gun: { grip: [0, -0.11, 0.11], fore: [-0.02, -0.06, -0.14] },
  railgun: { grip: [0, -0.12, 0.12], fore: [-0.02, -0.06, -0.18] },
  energy_rifle: { grip: [0, -0.12, 0.10], fore: [-0.02, -0.06, -0.14] },
  fang: { grip: [0, 0.0, 0.07] },
  zclaw: { grip: [0, 0.0, 0.08] },
  thunder: { grip: [0, -0.02, -0.06] },
};

export function addHands(g, id) {
  const pos = HAND_POS[id] || { grip: [0, -0.12, 0.1], fore: null };
  const skin = mat(0xd8a06a, { roughness: 0.85 });
  const glove = mat(0x39423a, { roughness: 0.9 });

  // 只做"握在护木/握把上的手"，不做前臂：第一人称里手臂离相机只有 0.4m，
  // 任何袖口状的大块都会被透视放大成挡住半个屏幕的电线杆，反而更假。
  const [gx, gy, gz] = pos.grip;
  add(g, B(0.062, 0.072, 0.088), glove, gx, gy + 0.004, gz, 0.15);
  add(g, B(0.048, 0.044, 0.05), skin, gx - 0.03, gy + 0.03, gz - 0.01);
  add(g, B(0.02, 0.05, 0.055), skin, gx + 0.032, gy + 0.02, gz - 0.02, 0, 0, -0.2);
  if (pos.fore) {
    const [fx, fy, fz] = pos.fore;
    add(g, B(0.06, 0.058, 0.08), glove, fx, fy, fz, 0.1);
    add(g, B(0.046, 0.042, 0.05), skin, fx + 0.03, fy + 0.026, fz + 0.012);
  }
}

// ---------------- 道具 ----------------
export function buildCrate(c, size) {
  const w = Math.max(0.05, c.max.x - c.min.x);
  const h = Math.max(0.05, c.max.y - c.min.y);
  const d = Math.max(0.05, c.max.z - c.min.z);
  // 取模结果在坐标为负时会得到 -1/-2（JS 的 % 保留符号），
  // 直接用会取到 colors[undefined] → 材质色 undefined，木箱变成纯白/纯黑。
  // 先取绝对值再取模，保证 0..2。
  const hash = Math.abs(Math.floor(c.min.x * 7 + c.min.z * 13)) % 3;
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

export function buildHealthBox() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.5, 0.6),
    new THREE.MeshStandardMaterial({ color: 0x2fbf71, roughness: 0.6, emissive: 0x0c5c2e, emissiveIntensity: 0.35 })
  );
  m.position.y = 0.25;
  m.castShadow = true;
  g.add(m);
  const cross = add(g, B(0.3, 0.12, 0.03), mat(0xf4faf6), 0, 0.3, 0.32);
  add(g, B(0.12, 0.3, 0.03), mat(0xf4faf6), 0, 0.3, 0.32);
  g.userData.pulse = cross;
  return g;
}

// 安放点字母牌：双面发光平面，远处也能认出 A/B 点
export function buildSiteSign(text, color = 0xffcc33) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  const rgba = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = rgba;
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 116, 116);
  ctx.fillStyle = rgba;
  ctx.font = 'bold 86px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(c);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 1.3),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false })
  );
  return mesh;
}

export function buildSiteRing(color, radius = 2.6) {  const g = new THREE.Group();
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
// ft：0=普通，1=琉璃猎人，2=尸王，3=尸仆
export function buildNameTag(name, hp, maxHp, zombie = false, team = 0, carrier = false, ft = 0) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  sprite.scale.set(1.9, 0.7, 1);
  sprite.userData = { name, hp, maxHp, zombie, team, carrier, ft, redraw() {
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
    let nameColor = d.zombie ? '#ffb0a0' : d.team === 1 ? '#cfe4ff' : d.team === 2 ? '#ffe0c2' : '#e8f2ea';
    if (d.ft === 1) nameColor = '#7dffd8'; // 琉璃猎人
    else if (d.ft === 2) nameColor = '#d9a0ff'; // 尸王
    else if (d.ft === 3) nameColor = '#b6ff9a'; // 尸仆
    ctx.fillStyle = nameColor;
    ctx.fillText(d.name, 128, 42);
    const w = 180, h = 13, x = 38, y = 60;
    ctx.fillStyle = 'rgba(0,0,0,.65)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    const pct = Math.max(0, Math.min(1, d.hp / Math.max(1, d.maxHp)));
    let barColor = d.zombie ? '#e74c3c' : d.team === 1 ? '#3d9bff' : d.team === 2 ? '#ffa13d' : '#3ddc63';
    if (d.ft === 1) barColor = '#38e0b0';
    else if (d.ft === 2) barColor = '#b45cff';
    else if (d.ft === 3) barColor = '#8aff6b';
    ctx.fillStyle = barColor;
    ctx.fillRect(x, y, w * pct, h);
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.strokeRect(x, y, w, h);
    tex.needsUpdate = true;
  } };
  sprite.userData.redraw();
  return sprite;
}
