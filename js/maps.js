// 地图构建：由共享地图数据生成 Three.js 场景。
// 材质/贴图按「地图 id」缓存，切图来回时不重复创建 canvas 与 GPU 纹理。

import * as THREE from 'three';
import { buildCrate, buildBarrel, buildPillar, buildSiteRing, buildSiteSign, buildAmmoBox, buildHealthBox, buildLightGlow } from './models.js';

const texCache = new Map();
const matCache = new Map();

function cachedMat(key, factory) {
  if (!matCache.has(key)) matCache.set(key, factory());
  return matCache.get(key);
}

function hex(c) {
  return '#' + (c >>> 0).toString(16).padStart(6, '0');
}

// 地面贴图：底色 + 噪点 + 网格线，网格线随地图强调色变化（工业地图冷灰、生化地图暗绿）
function floorTexture(map) {
  const key = `floor:${map.id}`;
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = hex(map.floorColor ?? 0x6d7f70);
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(${30 + Math.random() * 40},${38 + Math.random() * 40},${32 + Math.random() * 30},0.25)`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  ctx.strokeStyle = `rgba(12,20,16,0.22)`;
  ctx.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 64, 0);
    ctx.lineTo(i * 64, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * 64);
    ctx.lineTo(512, i * 64);
    ctx.stroke();
  }
  // 中心行车线：给大地面一点方向感，避免"纯色地板"的空旷
  ctx.strokeStyle = `rgba(220,200,120,0.10)`;
  ctx.lineWidth = 10;
  ctx.setLineDash([54, 42]);
  ctx.beginPath();
  ctx.moveTo(256, 0);
  ctx.lineTo(256, 512);
  ctx.stroke();
  ctx.setLineDash([]);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(map.size.x / 8, map.size.z / 8);
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

function wallTexture(map) {
  const key = `wall:${map.id}`;
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = hex(map.wallColor ?? 0x8d948d);
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = 'rgba(40,46,40,0.45)';
  for (let x = 0; x < 256; x += 64) {
    ctx.fillRect(x, 0, 3, 256);
    ctx.fillRect(0, x, 256, 3);
  }
  // 墙脚污渍 + 竖向水渍
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = `rgba(24,28,24,${0.06 + Math.random() * 0.14})`;
    ctx.fillRect(Math.random() * 256, 180 + Math.random() * 70, 8 + Math.random() * 26, 40);
  }
  ctx.fillStyle = 'rgba(18,22,18,0.30)';
  ctx.fillRect(0, 232, 256, 24);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  texCache.set(key, tex);
  return tex;
}

export function buildMapMesh(map) {
  const group = new THREE.Group();
  group.userData.mapId = map.id;

  // ---------- 地面 ----------
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(map.size.x, map.size.z),
    new THREE.MeshStandardMaterial({ map: floorTexture(map), roughness: 0.96 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const wallTex = wallTexture(map);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.82 });
  const floorBoxMat = cachedMat('floorbox', () => new THREE.MeshStandardMaterial({ color: 0x59645c, roughness: 0.85 }));
  const stepMat = cachedMat('step', () => new THREE.MeshStandardMaterial({ color: 0x7a8280, roughness: 0.8 }));
  const metalMat = cachedMat('metal', () => new THREE.MeshStandardMaterial({ color: 0x6f7a82, metalness: 0.55, roughness: 0.45 }));
  const grateMat = cachedMat('grate', () => new THREE.MeshStandardMaterial({ color: 0x4d565e, metalness: 0.45, roughness: 0.6 }));

  // ---------- 碰撞体 ----------
  for (const c of map.colliders) {
    const w = c.max.x - c.min.x;
    const h = c.max.y - c.min.y;
    const d = c.max.z - c.min.z;
    let mesh;
    if (c.type === 'crate') {
      mesh = buildCrate(c, { w, h, d });
    } else if (c.type === 'barrel') {
      mesh = buildBarrel(c);
    } else if (c.type === 'pillar') {
      mesh = buildPillar(c);
    } else {
      const material = c.type === 'floor' ? floorBoxMat
        : c.type === 'step' ? stepMat
          : c.type === 'platform' ? grateMat
            : c.type === 'beam' ? metalMat
              : wallMat;
      mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(c.min.x + w / 2, c.min.y + h / 2, c.min.z + d / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // 平台加一层薄薄的发光边条，多层地图里一眼看出可站立面
      if (c.type === 'platform' && h < 0.5) {
        const edge = new THREE.Mesh(
          new THREE.BoxGeometry(w, 0.04, d),
          new THREE.MeshStandardMaterial({ color: 0xdfae4a, emissive: 0x8a5a10, emissiveIntensity: 1.2 })
        );
        edge.position.y = h / 2 + 0.02;
        mesh.add(edge);
      }
    }
    group.add(mesh);
  }

  // ---------- 天花板（室内地图）----------
  if (map.ceiling) {
    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(map.size.x, map.size.z),
      new THREE.MeshStandardMaterial({
        color: map.ceiling.color ?? 0x1c2430,
        roughness: 0.95,
        side: THREE.DoubleSide,
        // 室内天花板正对下方光源很少，给一点自发光避免变成"头顶黑洞"
        emissive: map.ceiling.emissive ?? 0x0a1210,
        emissiveIntensity: 1,
      })
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = map.ceiling.y ?? 8;
    group.add(ceil);
  }

  // ---------- 安放点 ----------
  for (const site of map.sites || []) {
    const color = site.color || 0xffcc33;
    const ring = buildSiteRing(color, site.radius);
    ring.position.set(site.pos.x, (site.pos.y ?? 0) + 0.06, site.pos.z);
    group.add(ring);
    const sign = buildSiteSign(site.id, color);
    sign.position.set(site.pos.x, (site.pos.y ?? 0) + 2.4, site.pos.z);
    sign.userData.billboard = true;
    group.add(sign);
  }

  // ---------- 补给箱 ----------
  for (const box of map.ammoBoxes || []) {
    const m = buildAmmoBox();
    m.position.set(box.pos.x, box.pos.y ?? 0, box.pos.z);
    group.add(m);
  }
  for (const box of map.healthBoxes || []) {
    const m = buildHealthBox();
    m.position.set(box.pos.x, box.pos.y ?? 0, box.pos.z);
    group.add(m);
  }

  // ---------- 装饰 ----------
  let realLights = 0;
  for (const p of map.props || []) {
    switch (p.type) {
      case 'light': {
        // 真点光源上限 4 个（前向渲染光源过多会明显掉帧），其余只保留发光贴片
        if (realLights < 4) {
          const light = new THREE.PointLight(p.color || 0xfff2c0, p.power ?? 22, p.distance ?? 16, 1.8);
          light.position.set(p.pos.x, p.pos.y ?? 5, p.pos.z);
          group.add(light);
          realLights += 1;
        }
        const glow = buildLightGlow(p.color || 0xfff2c0);
        glow.position.set(p.pos.x, p.pos.y ?? 5, p.pos.z);
        group.add(glow);
        break;
      }
      case 'strip': {
        // 灯带：细长自发光条，代替额外的点光源做氛围
        const s = p.size || { x: 2, y: 0.06, z: 0.12 };
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(s.x, s.y, s.z),
          new THREE.MeshStandardMaterial({
            color: p.color ?? 0x9fe6ff,
            emissive: p.color ?? 0x9fe6ff,
            emissiveIntensity: p.intensity ?? 2.2,
          })
        );
        m.position.set(p.pos.x, p.pos.y ?? 4, p.pos.z);
        if (p.rot) m.rotation.set(p.rot.x || 0, p.rot.y || 0, p.rot.z || 0);
        group.add(m);
        break;
      }
      case 'sign': {
        const sign = buildSiteSign(p.text || '', p.color ?? 0x9fe6ff);
        sign.scale.setScalar(p.scale ?? 1);
        sign.position.set(p.pos.x, p.pos.y ?? 3, p.pos.z);
        if (p.rot) sign.rotation.set(p.rot.x || 0, p.rot.y || 0, p.rot.z || 0);
        group.add(sign);
        break;
      }
      case 'pipe': {
        const len = p.len ?? 8;
        const horizontal = (p.axis ?? 'x') !== 'y';
        const m = new THREE.Mesh(
          new THREE.CylinderGeometry(p.radius ?? 0.16, p.radius ?? 0.16, len, 10, 1, true),
          metalMat
        );
        m.position.set(p.pos.x, p.pos.y ?? 4, p.pos.z);
        if (horizontal) m.rotation.z = Math.PI / 2;
        if ((p.axis ?? 'x') === 'z') m.rotation.set(Math.PI / 2, 0, 0);
        group.add(m);
        break;
      }
      case 'barrier': {
        const w = p.w ?? 2.2;
        const h = p.h ?? 1.0;
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, 0.12),
          new THREE.MeshStandardMaterial({ color: p.color ?? 0xc8b23a, roughness: 0.7 })
        );
        m.position.set(p.pos.x, (p.pos.y ?? 0) + h / 2, p.pos.z);
        m.rotation.y = p.rot?.y ?? 0;
        m.castShadow = true;
        group.add(m);
        break;
      }
      case 'silhouette': {
        // 远景建筑剪影：不参与碰撞、不投影，只为把地图边界"做厚"
        const s = p.size || { x: 8, y: 12, z: 8 };
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(s.x, s.y, s.z),
          new THREE.MeshStandardMaterial({ color: p.color ?? 0x151d26, roughness: 1 })
        );
        m.position.set(p.pos.x, (p.pos.y ?? 0) + s.y / 2, p.pos.z);
        group.add(m);
        break;
      }
      case 'sun': {
        const glow = buildLightGlow(p.color ?? 0xfff0c0);
        glow.scale.setScalar(p.scale ?? 22);
        glow.position.set(p.pos.x, p.pos.y ?? 40, p.pos.z);
        glow.material.opacity = 0.75;
        group.add(glow);
        break;
      }
      default:
        break;
    }
  }

  return group;
}
