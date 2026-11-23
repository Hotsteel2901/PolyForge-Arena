// 程序化精细建模（Ultra Edition）：角色（已彻底纠正面朝为 -Z）、高精细第一人称枪械、
// 战术爪刃匕首、修复并重做的双持异变尸爪、精细化地图道具与补给箱。零外部资产。

import * as THREE from 'three';

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = `${color}|${opts.metalness ?? 0.2}|${opts.roughness ?? 0.75}|${opts.emissive ?? 0}|${opts.emissiveIntensity ?? 1}|${opts.transparent ? 1 : 0}|${opts.opacity ?? 1}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color,
      metalness: opts.metalness ?? 0.2,
      roughness: opts.roughness ?? 0.75,
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      transparent: !!opts.transparent,
      opacity: opts.opacity ?? 1,
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
const C = (rt, rb, h, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg);

// ---------------- 玩家模型（统一严格朝向 -Z，与相机和 yaw=0 完全一致！） ----------------
export function buildPlayer({ zombie = false, team = 1 } = {}) {
  const root = new THREE.Group();
  // 所有身体构件装入 rig，整体旋转 PI 让原 +Z 正面严格对齐到 -Z 前方；
  // 这样无论跑步摆腿、持枪瞄准、头盔护目镜、丧尸扑击，朝向与移动方向 100% 吻合。
  const rig = new THREE.Group();
  rig.rotation.y = Math.PI;
  root.add(rig);

  const skin = zombie ? 0x7b9656 : 0xd8a06a;
  const suit = zombie ? 0x3f5427 : team === 1 ? 0x1d5ca8 : 0xa63c1e;
  const suitDark = zombie ? 0x2b3b18 : team === 1 ? 0x143b6e : 0x6d2511;
  const trim = zombie ? 0xa3e65c : team === 1 ? 0x62d4ff : 0xffaa4c;
  const dark = zombie ? 0x222c17 : 0x1e252e;
  const metalMat = mat(0x5d6875, { metalness: 0.5, roughness: 0.4 });
  const parts = {};

  const legGeo = { thigh: B(0.165, 0.42, 0.185), shin: B(0.145, 0.38, 0.165), boot: B(0.165, 0.125, 0.27) };
  for (const [side, key] of [[-1, 'legL'], [1, 'legR']]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.115, 0.86, 0);
    add(leg, legGeo.thigh, mat(suitDark), 0, -0.21, 0);
    // 战术腿袋
    add(leg, B(0.04, 0.16, 0.11), mat(dark), side * 0.09, -0.22, 0.01);
    add(leg, legGeo.shin, mat(suit), 0, -0.60, 0);
    // 靴子严格朝向正面 (+Z in rig = -Z in world)
    add(leg, legGeo.boot, mat(dark), 0, -0.82, 0.045);
    add(leg, B(0.155, 0.04, 0.09), metalMat, 0, -0.84, 0.16);
    // 战术护膝
    add(leg, B(0.155, 0.10, 0.14), mat(trim, { roughness: 0.45 }), 0, -0.40, 0.035);
    rig.add(leg);
    parts[key] = leg;
  }

  const torso = new THREE.Group();
  torso.position.set(0, 0.86, 0);
  add(torso, B(0.42, 0.48, 0.24), mat(suit), 0, 0.24, 0);
  // 战术防弹插板背心 + 三联弹匣袋
  add(torso, B(0.45, 0.32, 0.28), mat(suitDark, { roughness: 0.6 }), 0, 0.28, 0.008);
  for (let i = -1; i <= 1; i++) {
    add(torso, B(0.085, 0.12, 0.065), mat(dark), i * 0.105, 0.21, 0.155);
  }
  // 胸前发光阵营标识条
  add(torso, B(0.14, 0.045, 0.03), mat(trim, { emissive: trim, emissiveIntensity: 1.5, roughness: 0.3 }), -0.11, 0.37, 0.15);
  add(torso, B(0.43, 0.065, 0.26), mat(dark), 0, 0.03, 0);
  // 战术背包 + 通信天线
  add(torso, B(0.29, 0.32, 0.16), mat(dark, { roughness: 0.68 }), 0, 0.27, -0.19);
  add(torso, B(0.06, 0.34, 0.025), mat(trim, { emissive: trim, emissiveIntensity: 0.9 }), 0, 0.27, -0.275);
  if (!zombie) {
    add(torso, C(0.008, 0.012, 0.34, 6), metalMat, -0.11, 0.56, -0.19);
  } else {
    // 丧尸背部暴露骨刺
    const bone = mat(0xd8cfb8, { roughness: 0.55 });
    for (let i = 0; i < 3; i++) {
      add(torso, new THREE.ConeGeometry(0.025, 0.11, 5), bone, 0, 0.16 + i * 0.11, -0.26, -Math.PI * 0.4, 0, 0);
    }
  }
  // 颈部
  add(torso, C(0.055, 0.062, 0.09, 8), mat(skin), 0, 0.50, 0);
  rig.add(torso);
  parts.torso = torso;

  const head = new THREE.Group();
  head.position.set(0, 1.36, 0);
  add(head, new THREE.SphereGeometry(0.155, 14, 12), mat(skin), 0, 0.13, 0);
  // 战术头盔 + 侧导轨 + 夜视仪支架
  add(head, new THREE.SphereGeometry(0.178, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), mat(zombie ? 0x364720 : suitDark, { roughness: 0.5 }), 0, 0.14, 0);
  add(head, B(0.27, 0.078, 0.045), mat(zombie ? 0x1e160d : 0x0c1622, { metalness: 0.65, roughness: 0.2 }), 0, 0.14, 0.155);
  add(head, B(0.24, 0.05, 0.05), mat(skin), 0, 0.05, 0.135);
  if (zombie) {
    const eye = new THREE.MeshStandardMaterial({ color: 0xff3a20, emissive: 0xff2200, emissiveIntensity: 3.0 });
    add(head, new THREE.SphereGeometry(0.028, 6, 6), eye, 0.058, 0.152, 0.165);
    add(head, new THREE.SphereGeometry(0.028, 6, 6), eye, -0.058, 0.152, 0.165);
    add(head, B(0.20, 0.055, 0.06), mat(0x6e1f18, { roughness: 0.85 }), 0, -0.015, 0.105);
  } else {
    // 头盔发光侧徽 + 前额战术镜架
    add(head, B(0.04, 0.055, 0.11), mat(trim, { emissive: trim, emissiveIntensity: 1.4 }), 0.165, 0.16, 0);
    add(head, B(0.04, 0.055, 0.11), mat(trim, { emissive: trim, emissiveIntensity: 1.4 }), -0.165, 0.16, 0);
    add(head, B(0.07, 0.04, 0.045), metalMat, 0, 0.24, 0.15);
  }
  rig.add(head);
  parts.head = head;

  const gunMat = mat(0x3f4854, { metalness: 0.5, roughness: 0.4 });
  for (const [side, key] of [[-1, 'armL'], [1, 'armR']]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.26, 1.28, 0);
    add(arm, B(0.125, 0.26, 0.135), mat(suit), 0, -0.13, 0);
    add(arm, B(0.112, 0.24, 0.122), mat(suitDark), 0, -0.36, 0);
    add(arm, B(0.102, 0.102, 0.112), mat(zombie ? skin : dark), 0, -0.50, 0);
    // 装甲肩垫 + 阵营色条
    add(arm, B(0.16, 0.095, 0.18), mat(trim, { roughness: 0.45 }), side * 0.025, 0.02, 0);
    rig.add(arm);
    parts[key] = arm;
  }

  if (zombie) {
    const clawMat = mat(0xe6dcc8, { roughness: 0.35, metalness: 0.15 });
    const bloodTip = mat(0x9e1818, { emissive: 0x550808, emissiveIntensity: 0.8 });
    for (const key of ['armL', 'armR']) {
      const arm = parts[key];
      const side = key === 'armR' ? 1 : -1;
      for (let i = -1; i <= 1; i++) {
        // 爪尖沿手臂末端 (-Y) 向下前伸，双臂抬起后严格指向前方！
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.18, 5), clawMat);
        claw.position.set(i * 0.036, -0.60, 0.03);
        claw.rotation.x = Math.PI + 0.22;
        claw.rotation.z = i * 0.15;
        arm.add(claw);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.07, 5), bloodTip);
        tip.position.set(i * 0.036, -0.68, 0.048);
        tip.rotation.x = Math.PI + 0.25;
        arm.add(tip);
      }
      arm.userData.side = side;
    }
    torso.rotation.x = 0.18;
    parts.armL.rotation.x = -1.32;
    parts.armR.rotation.x = -1.36;
    parts.armL.rotation.z = 0.07;
    parts.armR.rotation.z = -0.07;
    head.rotation.x = 0.12;
  } else {
    parts.armR.rotation.x = -1.28;
    parts.armR.rotation.z = -0.12;
    parts.armL.rotation.x = -1.34;
    parts.armL.rotation.z = 0.30;
    // 第三人称步枪：严格指向 rig +Z（即世界前方 -Z！）
    const gun = new THREE.Group();
    gun.position.set(0.06, 1.15, 0.32);
    add(gun, B(0.072, 0.095, 0.46), gunMat, 0, 0, 0);
    add(gun, B(0.052, 0.15, 0.095), mat(0x1b2026), 0, -0.08, 0.07, 0.16);
    add(gun, B(0.045, 0.11, 0.08), mat(0x1b2026), 0, -0.055, -0.14);
    // 枪管严格朝前 (+0.32 in rig = -Z in world)
    add(gun, C(0.017, 0.017, 0.24, 8), gunMat, 0, 0.015, 0.31, Math.PI / 2, 0, 0);
    // 顶部光学瞄具
    add(gun, B(0.042, 0.048, 0.12), mat(0x1b2026), 0, 0.07, 0.02);
    rig.add(gun);
    parts.gun = gun;
  }

  root.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  root.userData.parts = parts;
  root.userData.zombie = zombie;
  return root;
}

// ---------------- 第一人称极致精细枪械 / 匕首 / 双持异变尸爪 ----------------
export function buildViewmodel(id) {
  const g = new THREE.Group();
  const metal = mat(0x768290, { metalness: 0.48, roughness: 0.38 });
  const gunmetal = mat(0x4c5664, { metalness: 0.52, roughness: 0.36 });
  const dark = mat(0x2a313a, { metalness: 0.32, roughness: 0.56 });
  const polymer = mat(0x23272e, { metalness: 0.12, roughness: 0.78 });
  const grip = mat(0x2b241e, { metalness: 0.1, roughness: 0.86 });
  const accent = mat(0x9e522b, { metalness: 0.32, roughness: 0.5 });
  const railMat = mat(0x3a424d, { metalness: 0.45, roughness: 0.45 });
  const redDot = mat(0xff3838, { emissive: 0xff2222, emissiveIntensity: 2.6 });
  const cyanGlow = mat(0x42e4ff, { emissive: 0x1ac8ff, emissiveIntensity: 2.6 });
  const greenDot = mat(0x38ff7a, { emissive: 0x22e866, emissiveIntensity: 2.4 });
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -0.54);

  // 辅助：皮卡汀尼战术导轨齿
  const addRail = (zStart, zEnd, y, width = 0.036) => {
    const len = Math.abs(zEnd - zStart);
    const mid = (zStart + zEnd) / 2;
    add(g, B(width, 0.012, len), railMat, 0, y, mid);
    const steps = Math.max(2, Math.floor(len / 0.032));
    for (let i = 0; i < steps; i++) {
      const z = zStart - (i + 0.5) * (len / steps);
      add(g, B(width + 0.004, 0.008, 0.012), dark, 0, y + 0.008, z);
    }
  };

  switch (id) {
    case 'k9': {
      // K9 战术微声手枪：双色套筒 + 消音器 + 底部战术激光 + 氚光机械瞄具
      add(g, B(0.068, 0.088, 0.25), metal, 0, 0.015, -0.01);
      add(g, B(0.062, 0.042, 0.24), polymer, 0, -0.035, 0.0);
      // 抛壳窗与防滑锯齿
      add(g, B(0.072, 0.032, 0.065), dark, 0.003, 0.028, 0.0);
      // 战术消音管
      add(g, C(0.022, 0.022, 0.19, 12), dark, 0, 0.024, -0.22, Math.PI / 2, 0, 0);
      add(g, C(0.025, 0.025, 0.018, 12), gunmetal, 0, 0.024, -0.14, Math.PI / 2, 0, 0);
      // 下挂激光模块
      add(g, B(0.036, 0.032, 0.085), dark, 0, -0.055, -0.09);
      add(g, C(0.008, 0.008, 0.012, 8), redDot, 0, -0.055, -0.135, Math.PI / 2, 0, 0);
      // 握把 + 延长弹匣底板
      add(g, B(0.058, 0.145, 0.064), grip, 0, -0.115, 0.065, 0.22);
      add(g, B(0.054, 0.026, 0.07), gunmetal, 0, -0.19, 0.085, 0.22);
      // 三点氚光瞄具
      add(g, B(0.012, 0.018, 0.016), greenDot, -0.018, 0.068, 0.095);
      add(g, B(0.012, 0.018, 0.016), greenDot, 0.018, 0.068, 0.095);
      add(g, B(0.01, 0.02, 0.014), redDot, 0, 0.068, -0.12);
      muzzle.position.set(0, 0.024, -0.33);
      break;
    }
    case 'vx9': {
      // VX9 极速冲锋枪：紧凑聚合物机匣 + 镂空护木 + 倾斜延长弹匣 + 微型全息镜 + 侧激光
      add(g, B(0.082, 0.118, 0.34), gunmetal, 0, 0.015, 0.02);
      add(g, B(0.072, 0.088, 0.20), polymer, 0, 0.012, -0.22);
      // 护木散热槽
      for (let i = 0; i < 4; i++) add(g, B(0.076, 0.018, 0.022), dark, 0, 0.016, -0.15 - i * 0.042);
      // 短枪管 + 制退器
      add(g, C(0.020, 0.020, 0.16, 10), dark, 0, 0.018, -0.36, Math.PI / 2, 0, 0);
      add(g, C(0.026, 0.024, 0.05, 10), metal, 0, 0.018, -0.44, Math.PI / 2, 0, 0);
      // 倾斜加长弹匣 + 握把 + 折叠托
      add(g, B(0.052, 0.22, 0.056), dark, 0, -0.14, -0.07, -0.22);
      add(g, B(0.056, 0.022, 0.062), accent, 0, -0.245, -0.095, -0.22);
      add(g, B(0.062, 0.155, 0.064), grip, 0, -0.115, 0.115, 0.2);
      add(g, B(0.05, 0.09, 0.14), polymer, 0, -0.02, 0.22);
      // 顶部导轨 + 反射式红点镜
      addRail(0.14, -0.26, 0.078, 0.038);
      add(g, B(0.058, 0.056, 0.075), dark, 0, 0.11, 0.04);
      add(g, B(0.044, 0.04, 0.01), mat(0x70d8ff, { transparent: true, opacity: 0.35 }), 0, 0.114, 0.04);
      add(g, B(0.009, 0.009, 0.012), redDot, 0, 0.114, 0.04);
      // 侧面战术激光盒
      add(g, B(0.032, 0.034, 0.08), dark, 0.052, 0.02, -0.20);
      add(g, C(0.007, 0.007, 0.012, 8), cyanGlow, 0.052, 0.02, -0.242, Math.PI / 2, 0, 0);
      muzzle.position.set(0, 0.018, -0.48);
      break;
    }
    case 'arc17': {
      // ARC-17 突击步枪：精密铣削上下机匣 + 战术浮置护木 + 弯弹匣 + 斜握把 + ACOG 光学瞄具
      add(g, B(0.084, 0.125, 0.38), gunmetal, 0, 0.018, 0.02);
      add(g, B(0.072, 0.092, 0.28), dark, 0, 0.022, -0.28);
      // 导气管 + 精密枪管 + 三叉消焰器
      add(g, C(0.012, 0.012, 0.22, 8), metal, 0, 0.055, -0.32, Math.PI / 2, 0, 0);
      add(g, C(0.019, 0.019, 0.24, 10), gunmetal, 0, 0.024, -0.46, Math.PI / 2, 0, 0);
      add(g, C(0.026, 0.022, 0.055, 8), dark, 0, 0.024, -0.58, Math.PI / 2, 0, 0);
      // 分段弯弹匣
      add(g, B(0.054, 0.13, 0.075), dark, 0, -0.10, -0.09, 0.12);
      add(g, B(0.052, 0.11, 0.072), dark, 0, -0.20, -0.115, 0.28);
      add(g, B(0.056, 0.018, 0.076), accent, 0, -0.25, -0.132, 0.28);
      // 手枪握把 + 前斜握把 + 伸缩托
      add(g, B(0.062, 0.155, 0.068), grip, 0, -0.115, 0.115, 0.22);
      add(g, B(0.048, 0.09, 0.048), polymer, 0, -0.065, -0.24, -0.32);
      add(g, B(0.068, 0.11, 0.18), polymer, 0, -0.01, 0.26);
      // 顶部全长皮轨 + 全息战术镜
      addRail(0.18, -0.38, 0.084, 0.04);
      add(g, C(0.028, 0.032, 0.15, 12), dark, 0, 0.124, 0.03, Math.PI / 2, 0, 0);
      add(g, C(0.024, 0.024, 0.01, 10), mat(0x5ad7ff, { transparent: true, opacity: 0.45 }), 0, 0.124, -0.045, Math.PI / 2, 0, 0);
      add(g, B(0.01, 0.01, 0.012), greenDot, 0, 0.124, 0.08);
      muzzle.position.set(0, 0.024, -0.62);
      break;
    }
    case 'warden': {
      // Warden 破门霰弹枪：重型机匣 + 双管（枪管+下弹仓管）+ 橘红防滑泵动护木 + 侧挂备用弹壳 + 鬼环瞄具
      add(g, B(0.095, 0.125, 0.34), gunmetal, 0, 0.015, 0.02);
      // 枪管 + 弹仓管 + 枪口破门锯齿
      add(g, C(0.024, 0.024, 0.44, 12), dark, 0, 0.045, -0.34, Math.PI / 2, 0, 0);
      add(g, C(0.021, 0.021, 0.38, 12), metal, 0, -0.005, -0.31, Math.PI / 2, 0, 0);
      add(g, C(0.031, 0.028, 0.055, 8), metal, 0, 0.045, -0.56, Math.PI / 2, 0, 0);
      // 橘红战术泵动护木
      add(g, B(0.086, 0.078, 0.22), accent, 0, -0.01, -0.26);
      for (let i = 0; i < 5; i++) add(g, B(0.09, 0.082, 0.012), dark, 0, -0.01, -0.18 - i * 0.038);
      // 机匣左侧 4 发红铜霰弹弹壳架
      const shellRed = mat(0xc82820, { roughness: 0.4 });
      const brass = mat(0xd8a83a, { metalness: 0.7, roughness: 0.3 });
      for (let i = 0; i < 4; i++) {
        add(g, C(0.011, 0.011, 0.052, 8), shellRed, -0.058, 0.022, 0.06 - i * 0.034);
        add(g, C(0.0115, 0.0115, 0.016, 8), brass, -0.058, -0.008, 0.06 - i * 0.034);
      }
      // 握把 + 顶部导轨 + 鬼环照门
      add(g, B(0.068, 0.16, 0.072), grip, 0, -0.115, 0.13, 0.26);
      addRail(0.14, -0.12, 0.082, 0.042);
      add(g, new THREE.TorusGeometry(0.022, 0.005, 8, 14), dark, 0, 0.112, 0.10);
      add(g, B(0.01, 0.022, 0.014), redDot, 0, 0.082, -0.52);
      muzzle.position.set(0, 0.045, -0.60);
      break;
    }
    case 'longshot': {
      // Longshot 反器材狙击步枪：精密悬浮长枪管 + 双腔制退器 + 高倍瞄准镜 + 侧置拉机柄 + 折叠两脚架
      add(g, B(0.082, 0.12, 0.38), gunmetal, 0, 0.015, 0.04);
      add(g, B(0.074, 0.086, 0.24), polymer, 0, 0.012, -0.22);
      // 超长重型枪管 + 宽体双腔制退器
      add(g, C(0.019, 0.022, 0.64, 12), dark, 0, 0.032, -0.44, Math.PI / 2, 0, 0);
      add(g, B(0.058, 0.044, 0.095), metal, 0, 0.032, -0.77);
      // 折叠两脚架
      add(g, C(0.009, 0.009, 0.16, 8), metal, -0.045, -0.04, -0.34, 0.4, 0, 0.2);
      add(g, C(0.009, 0.009, 0.16, 8), metal, 0.045, -0.04, -0.34, 0.4, 0, -0.2);
      // 高倍狙击瞄准镜（双镜环 + 目镜 + 大物镜 + 调节旋钮）
      addRail(0.16, -0.16, 0.078, 0.038);
      add(g, C(0.026, 0.026, 0.26, 14), dark, 0, 0.13, -0.02, Math.PI / 2, 0, 0);
      add(g, C(0.036, 0.028, 0.08, 14), gunmetal, 0, 0.13, -0.16, Math.PI / 2, 0, 0);
      add(g, C(0.032, 0.026, 0.06, 14), gunmetal, 0, 0.13, 0.12, Math.PI / 2, 0, 0);
      add(g, C(0.03, 0.03, 0.008, 12), mat(0x70c8ff, { emissive: 0x1a5a8a, emissiveIntensity: 0.7 }), 0, 0.13, 0.15, Math.PI / 2, 0, 0);
      add(g, C(0.012, 0.012, 0.028, 8), metal, 0, 0.162, -0.02);
      // 右侧拉机柄 + 大口径弹匣 + 握把
      add(g, C(0.008, 0.008, 0.06, 8), metal, 0.065, 0.02, 0.06, 0, 0, Math.PI / 2);
      add(g, new THREE.SphereGeometry(0.016, 8, 8), dark, 0.095, 0.02, 0.06);
      add(g, B(0.06, 0.13, 0.095), dark, 0, -0.10, -0.06);
      add(g, B(0.062, 0.155, 0.068), grip, 0, -0.115, 0.13, 0.2);
      muzzle.position.set(0, 0.032, -0.82);
      break;
    }
    case 'bruiser': {
      // Bruiser 压制轻机枪：宽体机匣 + 120发弹鼓 + 散热穿孔枪管护罩 + 提把 + 弹链盒
      add(g, B(0.105, 0.145, 0.42), gunmetal, 0, 0.02, 0.02);
      add(g, B(0.088, 0.096, 0.24), dark, 0, 0.025, -0.28);
      // 散热穿孔枪管 + 重型消焰器
      add(g, C(0.024, 0.024, 0.34, 12), dark, 0, 0.038, -0.44, Math.PI / 2, 0, 0);
      add(g, C(0.032, 0.032, 0.18, 12), metal, 0, 0.038, -0.34, Math.PI / 2, 0, 0);
      // 120发双侧大型战术弹鼓 + 黄铜弹链
      add(g, C(0.078, 0.078, 0.11, 16), mat(0x525c42, { roughness: 0.6 }), 0, -0.095, -0.05, Math.PI / 2, 0, 0);
      const brass = mat(0xd8a83a, { metalness: 0.72, roughness: 0.28 });
      for (let i = 0; i < 4; i++) add(g, C(0.008, 0.008, 0.045, 6), brass, -0.058, -0.015 - i * 0.018, -0.04, 0, 0, Math.PI / 2);
      // 顶部战术提把 + 全息准镜
      add(g, B(0.032, 0.02, 0.18), dark, 0, 0.135, -0.08);
      add(g, B(0.024, 0.05, 0.024), dark, 0, 0.11, -0.15);
      add(g, B(0.024, 0.05, 0.024), dark, 0, 0.11, -0.01);
      add(g, B(0.06, 0.052, 0.075), dark, 0, 0.115, 0.12);
      add(g, B(0.01, 0.01, 0.012), redDot, 0, 0.12, 0.12);
      add(g, B(0.066, 0.16, 0.07), grip, 0, -0.12, 0.13, 0.2);
      muzzle.position.set(0, 0.038, -0.62);
      break;
    }
    case 'fang': {
      // Fang 战术赛博爪刃（极致变帅！）：指环尾扣 + 缠绳握柄 + 镂空护手 + 钛合金双刃 + 发光猩红等离子刃缘 + 锯齿刀背
      const titanium = mat(0xc6d4e0, { metalness: 0.85, roughness: 0.22 });
      const darkSteel = mat(0x2d3540, { metalness: 0.75, roughness: 0.32 });
      const neonEdge = mat(0xff3b30, { emissive: 0xff261b, emissiveIntensity: 2.8, roughness: 0.15 });
      const cord = mat(0x1f242c, { roughness: 0.9 });
      // 尾部战术指环（Karambit Ring）
      add(g, new THREE.TorusGeometry(0.026, 0.0075, 10, 18), darkSteel, 0, -0.008, 0.145, 0, Math.PI / 2, 0);
      // 缠绳人体工学握柄
      add(g, B(0.036, 0.048, 0.135), cord, 0, 0.012, 0.062, -0.05);
      for (let i = 0; i < 4; i++) {
        add(g, B(0.040, 0.051, 0.012), accent, 0, 0.012, 0.018 + i * 0.028, -0.05);
      }
      // 镂空双翼护手
      add(g, B(0.095, 0.024, 0.026), darkSteel, 0, 0.024, -0.012);
      add(g, B(0.028, 0.042, 0.022), neonEdge, 0, 0.024, -0.012);
      // 渐宽弧形大马士革钛刀身 + 血槽
      add(g, B(0.016, 0.058, 0.26), titanium, 0, 0.046, -0.155, -0.08);
      add(g, B(0.020, 0.018, 0.19), darkSteel, 0, 0.054, -0.135, -0.08);
      // 刀背战术锯齿
      for (let i = 0; i < 5; i++) {
        add(g, B(0.018, 0.014, 0.016), darkSteel, 0, 0.076 + i * 0.003, -0.06 - i * 0.032, -0.35);
      }
      // 发光猩红等离子开刃线
      add(g, B(0.006, 0.012, 0.27), neonEdge, 0, 0.018, -0.158, -0.08);
      // 锐利棱面刀尖（朝前 -Z）
      add(g, new THREE.ConeGeometry(0.032, 0.13, 4), titanium, 0, 0.064, -0.34, -Math.PI / 2 - 0.10, Math.PI / 4, 0);
      add(g, new THREE.ConeGeometry(0.012, 0.135, 4), neonEdge, 0, 0.044, -0.342, -Math.PI / 2 - 0.10, Math.PI / 4, 0);
      muzzle.position.set(0, 0.05, -0.42);
      break;
    }
    case 'thunder': {
      // 战术破片手雷：格纹雷体 + 保险握片 + 拉环 + 发光定时灯
      add(g, new THREE.SphereGeometry(0.072, 14, 12), mat(0x4b5c34, { roughness: 0.48, metalness: 0.25 }), 0, 0, -0.11);
      add(g, new THREE.TorusGeometry(0.068, 0.008, 6, 16), dark, 0, 0.01, -0.11, Math.PI / 2, 0, 0);
      add(g, B(0.034, 0.042, 0.046), metal, 0, 0.065, -0.09);
      add(g, B(0.016, 0.095, 0.022), accent, 0.042, 0.025, -0.07, 0, 0, -0.28);
      add(g, new THREE.TorusGeometry(0.024, 0.006, 8, 12), metal, -0.03, 0.06, -0.14);
      add(g, new THREE.SphereGeometry(0.012, 8, 8), redDot, 0, 0.088, -0.09);
      muzzle.position.set(0, 0, -0.22);
      break;
    }
    case 'zclaw': {
      // 尸爪（彻底修复方向 + 极致变帅！）：双持异变利爪，零人类手套，全部爪尖严格朝向前方 (-Z)！
      const boneMat = mat(0xe8dec8, { roughness: 0.28, metalness: 0.18 });
      const obsidianMat = mat(0x281c24, { roughness: 0.35, metalness: 0.45 });
      const flesh = mat(0x4f682e, { roughness: 0.8 });
      const darkFlesh = mat(0x32421d, { roughness: 0.85 });
      const bioGlow = mat(0xff2a1e, { emissive: 0xff1e10, emissiveIntensity: 2.4 });
      const buildHandClaw = (side) => {
        const hg = new THREE.Group();
        // 右手靠主视野，左手在左侧对称护卫形成极具压迫感的双爪姿态
        hg.position.set(side > 0 ? 0.02 : -0.44, side > 0 ? -0.02 : -0.05, side > 0 ? 0.0 : 0.05);
        hg.rotation.set(0.08, side * -0.14, side * -0.18);
        // 变异肌腱前臂 + 撕裂袖口 + 猩红生物荧光血管
        add(hg, B(0.095, 0.092, 0.22), darkFlesh, 0, -0.02, 0.14);
        add(hg, B(0.105, 0.098, 0.06), mat(0x22261e, { roughness: 0.92 }), 0, -0.02, 0.22);
        add(hg, B(0.018, 0.018, 0.20), bioGlow, side * 0.025, 0.032, 0.11);
        add(hg, B(0.014, 0.014, 0.16), bioGlow, -side * 0.025, 0.028, 0.08);
        // 畸变手掌 + 骨质指节隆起
        add(hg, B(0.125, 0.085, 0.13), flesh, 0, 0.0, -0.01);
        // 4 根弧形向前伸展的锋利骨刃（Cone 默认指 +Y，旋转 rx = -Math.PI/2 严格朝前 -Z！）
        const offsets = [-0.056, -0.018, 0.020, 0.056];
        const lengths = [0.22, 0.28, 0.26, 0.20];
        for (let i = 0; i < 4; i++) {
          const ox = offsets[i];
          const len = lengths[i];
          // 粗壮变异指节
          add(hg, B(0.028, 0.032, 0.075), darkFlesh, ox, 0.008, -0.085, 0.12, -ox * 2.2, 0);
          // 根部黑曜石角质鞘
          add(hg, C(0.014, 0.020, 0.07, 6), obsidianMat, ox * 1.15, 0.012, -0.135, -Math.PI / 2 - 0.12, -ox * 2.4, 0);
          // 锋利骨白前弯利爪（严格朝前 -Z，微向下弯钩）
          add(hg, new THREE.ConeGeometry(0.016, len, 6), boneMat, ox * 1.38, -0.006, -0.15 - len * 0.48, -Math.PI / 2 - 0.22, -ox * 2.6, 0);
          // 血染发光爪尖
          add(hg, new THREE.ConeGeometry(0.008, 0.075, 5), bioGlow, ox * 1.48, -0.026, -0.15 - len * 0.85, -Math.PI / 2 - 0.28, -ox * 2.6, 0);
        }
        g.add(hg);
      };
      buildHandClaw(1);
      buildHandClaw(-1);
      muzzle.position.set(0, 0, -0.34);
      break;
    }
    case 'cryo_gun': {
      const ice = mat(0x88d4ff, { metalness: 0.55, roughness: 0.25 });
      const core = mat(0x55d8ff, { emissive: 0x22b8ff, emissiveIntensity: 2.6 });
      add(g, B(0.086, 0.13, 0.36), ice, 0, 0.015, 0.02);
      add(g, B(0.072, 0.09, 0.22), dark, 0, 0.015, -0.26);
      add(g, C(0.022, 0.022, 0.28, 12), mat(0xc8f0ff), 0, 0.024, -0.42, Math.PI / 2, 0, 0);
      add(g, C(0.036, 0.036, 0.14, 12), core, 0, 0.068, -0.05, Math.PI / 2, 0, 0);
      add(g, B(0.065, 0.16, 0.068), grip, 0, -0.12, 0.11, 0.2);
      add(g, B(0.055, 0.15, 0.06), dark, 0, -0.11, -0.10, 0.15);
      muzzle.position.set(0, 0.024, -0.58);
      break;
    }
    case 'railgun': {
      const coil = mat(0xff963a, { emissive: 0xff6e18, emissiveIntensity: 2.5 });
      add(g, B(0.095, 0.14, 0.46), gunmetal, 0, 0.02, 0.04);
      // 双平行电磁导轨 + 发光加速线圈
      add(g, B(0.022, 0.042, 0.54), dark, -0.028, 0.032, -0.36);
      add(g, B(0.022, 0.042, 0.54), dark, 0.028, 0.032, -0.36);
      for (let i = 0; i < 4; i++) {
        add(g, new THREE.TorusGeometry(0.038, 0.009, 8, 14), coil, 0, 0.032, -0.18 - i * 0.11);
      }
      add(g, B(0.068, 0.16, 0.07), grip, 0, -0.125, 0.13, 0.2);
      add(g, C(0.026, 0.026, 0.18, 12), dark, 0, 0.12, 0.02, Math.PI / 2, 0, 0);
      muzzle.position.set(0, 0.032, -0.66);
      break;
    }
    case 'energy_rifle': {
      const panel = mat(0x1f2f3c, { metalness: 0.5, roughness: 0.45 });
      add(g, B(0.088, 0.135, 0.40), gunmetal, 0, 0.02, 0.02);
      add(g, B(0.078, 0.096, 0.24), panel, 0, 0.02, -0.26);
      add(g, C(0.021, 0.021, 0.30, 12), dark, 0, 0.03, -0.44, Math.PI / 2, 0, 0);
      add(g, B(0.056, 0.046, 0.20), cyanGlow, 0, 0.072, -0.22);
      add(g, new THREE.TorusGeometry(0.026, 0.008, 8, 12), cyanGlow, 0, 0.03, -0.46);
      add(g, B(0.065, 0.155, 0.068), grip, 0, -0.12, 0.11, 0.2);
      add(g, B(0.055, 0.15, 0.06), dark, 0, -0.12, -0.11, 0.15);
      muzzle.position.set(0, 0.03, -0.60);
      break;
    }
    case 'plasma_shotgun': {
      // 新增模组武器：PX-12 等离子霰弹枪（双并联重型能量腔 + 紫色聚能环）
      const plasmaGlow = mat(0xd85aff, { emissive: 0xb830ff, emissiveIntensity: 2.6 });
      add(g, B(0.105, 0.14, 0.38), gunmetal, 0, 0.02, 0.02);
      add(g, C(0.026, 0.026, 0.36, 12), dark, -0.028, 0.036, -0.32, Math.PI / 2, 0, 0);
      add(g, C(0.026, 0.026, 0.36, 12), dark, 0.028, 0.036, -0.32, Math.PI / 2, 0, 0);
      add(g, B(0.09, 0.05, 0.22), plasmaGlow, 0, 0.088, -0.14);
      add(g, new THREE.TorusGeometry(0.042, 0.009, 8, 16), plasmaGlow, 0, 0.036, -0.42);
      add(g, B(0.07, 0.16, 0.072), grip, 0, -0.12, 0.12, 0.22);
      muzzle.position.set(0, 0.036, -0.54);
      break;
    }
    default:
      add(g, B(0.08, 0.12, 0.3), dark, 0, 0, 0);
  }

  // 尸爪严禁套人类手套！
  if (id !== 'zclaw') addHands(g, id);
  g.add(muzzle);

  const remap = new Map();
  g.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = false;
    let m = remap.get(o.material);
    if (!m) {
      m = o.material.clone();
      const hasStrongEmissive = m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b > 0.1);
      if (m.emissive && !hasStrongEmissive) {
        m.emissive = new THREE.Color(m.color).multiplyScalar(0.28);
        m.emissiveIntensity = 1;
      }
      if (m.metalness !== undefined) m.metalness = Math.min(m.metalness, 0.42);
      if (m.roughness !== undefined) m.roughness = Math.max(m.roughness, 0.36);
      m.needsUpdate = true;
      remap.set(o.material, m);
    }
    o.material = m;
  });
  g.userData.muzzle = muzzle;
  return g;
}

const HAND_POS = {
  k9: { grip: [0.005, -0.11, 0.06], fore: [-0.045, -0.095, 0.03] },
  vx9: { grip: [0, -0.115, 0.12], fore: [-0.02, -0.065, -0.12] },
  arc17: { grip: [0, -0.115, 0.115], fore: [-0.02, -0.065, -0.22] },
  warden: { grip: [0, -0.115, 0.125], fore: [-0.02, -0.045, -0.25] },
  longshot: { grip: [0, -0.115, 0.13], fore: [-0.02, -0.055, -0.20] },
  bruiser: { grip: [0, -0.12, 0.13], fore: [-0.02, -0.055, -0.16] },
  cryo_gun: { grip: [0, -0.115, 0.11], fore: [-0.02, -0.06, -0.16] },
  railgun: { grip: [0, -0.12, 0.13], fore: [-0.02, -0.06, -0.20] },
  energy_rifle: { grip: [0, -0.115, 0.11], fore: [-0.02, -0.06, -0.16] },
  plasma_shotgun: { grip: [0, -0.115, 0.12], fore: [-0.02, -0.05, -0.20] },
  fang: { grip: [0, 0.0, 0.065] },
  thunder: { grip: [0, -0.02, -0.06] },
};

export function addHands(g, id) {
  const pos = HAND_POS[id] || { grip: [0, -0.12, 0.1], fore: null };
  const skin = mat(0xd8a06a, { roughness: 0.85 });
  const glove = mat(0x283038, { roughness: 0.82 });
  const knuckle = mat(0x181e24, { metalness: 0.35, roughness: 0.5 });

  const [gx, gy, gz] = pos.grip;
  add(g, B(0.064, 0.072, 0.088), glove, gx, gy + 0.004, gz, 0.15);
  add(g, B(0.066, 0.020, 0.036), knuckle, gx, gy + 0.032, gz - 0.02, 0.15);
  add(g, B(0.046, 0.040, 0.048), skin, gx - 0.028, gy + 0.028, gz - 0.01);
  if (pos.fore) {
    const [fx, fy, fz] = pos.fore;
    add(g, B(0.062, 0.058, 0.082), glove, fx, fy, fz, 0.1);
    add(g, B(0.044, 0.038, 0.046), skin, fx + 0.028, fy + 0.024, fz + 0.012);
  }
}

// ---------------- 精细化地图道具 ----------------
export function buildCrate(c) {
  const w = Math.max(0.05, c.max.x - c.min.x);
  const h = Math.max(0.05, c.max.y - c.min.y);
  const d = Math.max(0.05, c.max.z - c.min.z);
  const hash = Math.abs(Math.floor(c.min.x * 7 + c.min.z * 13)) % 3;
  const colors = [0x8c6f3e, 0x6c593c, 0x52626e];
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color: colors[hash], roughness: 0.82, metalness: hash === 2 ? 0.35 : 0.08 })
  );
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  // 顶部与底部金属包边
  const trimM = mat(0x283038, { metalness: 0.45, roughness: 0.5 });
  const topBand = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.08, d + 0.04), trimM);
  topBand.position.y = h / 2 - 0.04;
  g.add(topBand);
  const botBand = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.08, d + 0.04), trimM);
  botBand.position.y = -h / 2 + 0.04;
  g.add(botBand);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(body.geometry),
    new THREE.LineBasicMaterial({ color: 0x161c22, transparent: true, opacity: 0.55 })
  );
  g.add(edges);
  g.position.set((c.min.x + c.max.x) / 2, (c.min.y + c.max.y) / 2, (c.min.z + c.max.z) / 2);
  return g;
}

export function buildBarrel(c) {
  const h = Math.max(0.1, c.max.y - c.min.y);
  const r = Math.max(0.3, (c.max.x - c.min.x) / 2);
  const g = new THREE.Group();
  const isRed = Math.abs(Math.floor(c.min.x + c.min.z)) % 2 === 0;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, h, 16),
    new THREE.MeshStandardMaterial({ color: isRed ? 0xa8362a : 0x5c7552, roughness: 0.45, metalness: 0.4 })
  );
  body.position.y = h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  // 金属加强筋与警示环
  const ribMat = mat(0x2c343c, { metalness: 0.55, roughness: 0.4 });
  for (const ry of [h * 0.28, h * 0.72]) {
    const rib = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.03, r * 1.03, 0.07, 16), ribMat);
    rib.position.y = ry;
    g.add(rib);
  }
  const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.94, r * 0.94, 0.06, 16), ribMat);
  top.position.y = h + 0.02;
  g.add(top);
  g.position.set((c.min.x + c.max.x) / 2, c.min.y, (c.min.z + c.max.z) / 2);
  return g;
}

export function buildPillar(c) {
  const h = Math.max(0.1, c.max.y - c.min.y);
  const r = Math.max(0.3, (c.max.x - c.min.x) / 2);
  const g = new THREE.Group();
  const col = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.86, r * 0.96, h, 14),
    new THREE.MeshStandardMaterial({ color: 0xadb8c2, roughness: 0.52, metalness: 0.25 })
  );
  col.position.y = h / 2;
  col.castShadow = true;
  col.receiveShadow = true;
  g.add(col);
  // 柱脚底座 + 柱头
  const capMat = mat(0x46525e, { metalness: 0.45, roughness: 0.45 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(r * 2.1, 0.26, r * 2.1), capMat);
  base.position.y = 0.13;
  g.add(base);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(r * 2.0, 0.22, r * 2.0), capMat);
  cap.position.y = h - 0.11;
  g.add(cap);
  g.position.set((c.min.x + c.max.x) / 2, c.min.y, (c.min.z + c.max.z) / 2);
  return g;
}

export function buildBomb() {
  const g = new THREE.Group();
  add(g, B(0.38, 0.16, 0.24), mat(0x2d3538, { metalness: 0.55, roughness: 0.45 }), 0, 0.1, 0);
  add(g, B(0.14, 0.04, 0.09), mat(0x102818, { emissive: 0x22ff66, emissiveIntensity: 1.5 }), -0.06, 0.19, 0);
  add(g, C(0.025, 0.025, 0.20, 8), mat(0x9aa5a0), 0.02, 0.22, -0.04);
  const light = add(g, new THREE.SphereGeometry(0.038, 8, 8), mat(0xff2020, { emissive: 0xff2020, emissiveIntensity: 2.8 }), 0.12, 0.19, 0.06);
  g.userData.light = light;
  g.userData.blink = 0;
  return g;
}

export function buildAmmoBox() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.84, 0.52, 0.62),
    new THREE.MeshStandardMaterial({ color: 0xdfa82e, roughness: 0.5, metalness: 0.25, emissive: 0x6b4d00, emissiveIntensity: 0.4 })
  );
  m.position.y = 0.26;
  m.castShadow = true;
  g.add(m);
  const cross = add(g, B(0.30, 0.12, 0.03), mat(0x1a1e22), 0, 0.30, 0.32);
  add(g, B(0.12, 0.30, 0.03), mat(0x1a1e22), 0, 0.30, 0.32);
  g.userData.pulse = cross;
  return g;
}

export function buildHealthBox() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.84, 0.52, 0.62),
    new THREE.MeshStandardMaterial({ color: 0x28c776, roughness: 0.5, metalness: 0.2, emissive: 0x0c6632, emissiveIntensity: 0.42 })
  );
  m.position.y = 0.26;
  m.castShadow = true;
  g.add(m);
  const cross = add(g, B(0.32, 0.12, 0.03), mat(0xf4faf6, { emissive: 0xffffff, emissiveIntensity: 0.6 }), 0, 0.30, 0.32);
  add(g, B(0.12, 0.32, 0.03), mat(0xf4faf6, { emissive: 0xffffff, emissiveIntensity: 0.6 }), 0, 0.30, 0.32);
  g.userData.pulse = cross;
  return g;
}

export function buildSiteSign(text, color = 0xffcc33) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  const rgba = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = rgba;
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 116, 116);
  ctx.fillStyle = rgba;
  ctx.font = 'bold 84px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(c);
  return new THREE.Mesh(
    new THREE.PlaneGeometry(1.35, 1.35),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false })
  );
}

export function buildSiteRing(color, radius = 2.6) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.32, radius, 44),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  g.add(ring);
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 36),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.11, depthWrite: false })
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
  g.addColorStop(0, 'rgba(255,255,235,0.95)');
  g.addColorStop(0.4, 'rgba(255,240,190,0.38)');
  g.addColorStop(1, 'rgba(255,240,190,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false }));
  sprite.scale.set(3.2, 3.2, 1);
  return sprite;
}

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
    if (d.ft === 1) nameColor = '#7dffd8';
    else if (d.ft === 2) nameColor = '#d9a0ff';
    else if (d.ft === 3) nameColor = '#b6ff9a';
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
