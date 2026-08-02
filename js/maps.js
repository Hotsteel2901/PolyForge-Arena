// 地图构建：由共享地图数据生成 Three.js 场景。

import * as THREE from 'three';
import { buildCrate, buildBarrel, buildPillar, buildSiteRing, buildAmmoBox, buildLightGlow } from './models.js';

export function buildMapMesh(map) {
  const group = new THREE.Group();
  // 地面
  const floorCanvas = document.createElement('canvas');
  floorCanvas.width = 512;
  floorCanvas.height = 512;
  const fctx = floorCanvas.getContext('2d');
  fctx.fillStyle = '#6d7f70';
  fctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i++) {
    fctx.fillStyle = `rgba(${40 + Math.random() * 40},${50 + Math.random() * 40},${45 + Math.random() * 30},0.25)`;
    fctx.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  fctx.strokeStyle = 'rgba(20,30,24,0.18)';
  fctx.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    fctx.beginPath();
    fctx.moveTo(i * 64, 0);
    fctx.lineTo(i * 64, 512);
    fctx.stroke();
    fctx.beginPath();
    fctx.moveTo(0, i * 64);
    fctx.lineTo(512, i * 64);
    fctx.stroke();
  }
  const floorTex = new THREE.CanvasTexture(floorCanvas);
  floorTex.repeat.set(map.size.x / 8, map.size.z / 8);
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(map.size.x, map.size.z),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.96 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // 墙体贴图
  const wallCanvas = document.createElement('canvas');
  wallCanvas.width = 256;
  wallCanvas.height = 256;
  const wctx = wallCanvas.getContext('2d');
  wctx.fillStyle = '#8d948d';
  wctx.fillRect(0, 0, 256, 256);
  wctx.fillStyle = 'rgba(60,66,60,0.5)';
  for (let x = 0; x < 256; x += 64) {
    wctx.fillRect(x, 0, 3, 256);
    wctx.fillRect(0, x, 256, 3);
  }
  for (let i = 0; i < 60; i++) {
    wctx.fillStyle = `rgba(30,35,30,${0.08 + Math.random() * 0.12})`;
    wctx.fillRect(Math.random() * 256, Math.random() * 256, 10, 2);
  }
  const wallTex = new THREE.CanvasTexture(wallCanvas);

  for (const c of map.colliders) {
    const w = c.max.x - c.min.x;
    const h = c.max.y - c.min.y;
    const d = c.max.z - c.min.z;
    if (c.type === 'crate') {
      group.add(buildCrate(c, { w, h, d }));
    } else if (c.type === 'barrel') {
      group.add(buildBarrel(c));
    } else if (c.type === 'pillar') {
      group.add(buildPillar(c));
    } else if (c.type === 'floor') {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color: 0x59645c, roughness: 0.85 })
      );
      mesh.position.set(c.min.x + w / 2, c.min.y + h / 2, c.min.z + d / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    } else if (c.type === 'step') {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color: 0x7a8280, roughness: 0.8 })
      );
      mesh.position.set(c.min.x + w / 2, c.min.y + h / 2, c.min.z + d / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    } else {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.82 })
      );
      mesh.position.set(c.min.x + w / 2, c.min.y + h / 2, c.min.z + d / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  // 安放点
  for (const site of map.sites || []) {
    const ring = buildSiteRing(site.color || 0xffcc33, site.radius);
    ring.position.set(site.pos.x, (site.pos.y ?? 0) + 0.06, site.pos.z);
    group.add(ring);
  }

  // 弹药箱
  for (const box of map.ammoBoxes || []) {
    const m = buildAmmoBox();
    m.position.set(box.pos.x, box.pos.y ?? 0, box.pos.z);
    group.add(m);
  }

  // 灯光装饰：真点光源最多 4 个（前向渲染光源过多会严重掉帧），其余只保留发光贴片
  let realLights = 0;
  for (const p of map.props || []) {
    if (p.type !== 'light') continue;
    if (realLights < 4) {
      const light = new THREE.PointLight(p.color || 0xfff2c0, 22, 16, 1.8);
      light.position.set(p.pos.x, p.pos.y ?? 5, p.pos.z);
      group.add(light);
      realLights += 1;
    }
    const glow = buildLightGlow(p.color || 0xfff2c0);
    glow.position.set(p.pos.x, p.pos.y ?? 5, p.pos.z);
    group.add(glow);
  }

  return group;
}
