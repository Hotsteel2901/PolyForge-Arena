// 特效：弹道、火花、血液、爆炸、烟雾、弹壳、枪口焰。对象池式管理。

import * as THREE from 'three';

export class Effects {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.items = [];
    this.maxItems = 420;
    this.muzzleLight = new THREE.PointLight(0xffb45e, 0, 9, 2);
    this.scene.add(this.muzzleLight);
  }

  _add(mesh, life, opts = {}) {
    if (this.items.length >= this.maxItems) {
      const old = this.items.shift();
      this.scene.remove(old.mesh);
    }
    const item = {
      mesh,
      life,
      maxLife: life,
      vel: opts.vel || null,
      grav: opts.grav ?? false,
      grow: opts.grow ?? 0,
      fade: opts.fade ?? false,
      spin: opts.spin || null,
      onDone: opts.onDone || null,
      userData: opts.userData || {},
    };
    this.items.push(item);
    this.scene.add(mesh);
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      if (it.life <= 0) {
        if (it.onDone) it.onDone(it);
        this.scene.remove(it.mesh);
        this.items.splice(i, 1);
        continue;
      }
      if (it.vel) {
        it.mesh.position.x += it.vel.x * dt;
        it.mesh.position.y += it.vel.y * dt;
        it.mesh.position.z += it.vel.z * dt;
        if (it.grav) it.vel.y -= 12 * dt;
      }
      if (it.grow) {
        const s = it.mesh.scale.x + it.grow * dt;
        it.mesh.scale.set(s, s, s);
      }
      if (it.spin) it.mesh.rotation.x += it.spin * dt;
      if (it.fade && it.mesh.material) {
        it.mesh.material.opacity = Math.max(0, (it.life / it.maxLife) * (it.userData.opacity ?? 1));
      }
    }
  }

  muzzle(anchor) {
    const sprite = this._flashSprite();
    sprite.position.copy(anchor.getWorldPosition(new THREE.Vector3()));
    sprite.scale.set(0.28, 0.28, 1);
    this._add(sprite, 0.06, { fade: true, userData: { opacity: 0.9 } });
    this.muzzleLight.position.copy(sprite.position);
    this.muzzleLight.intensity = 14;
    setTimeout(() => {
      if (this.muzzleLight.intensity > 1) this.muzzleLight.intensity = 0;
    }, 40);
  }

  _flashSprite() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,220,1)');
    g.addColorStop(0.35, 'rgba(255,190,80,0.8)');
    g.addColorStop(1, 'rgba(255,120,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }));
  }

  tracer(from, to, color = 0xa8d8ff) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z),
    ]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    this._add(line, 0.07, { fade: true, userData: { opacity: 0.85 } });
  }

  impact(pos, kind = 'spark') {
    const color = kind === 'blood' ? 0xb41f1f : kind === 'heal' ? 0x59e89a : 0xffd27a;
    const count = kind === 'blood' ? 10 : 8;
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.022, 5, 4),
        new THREE.MeshBasicMaterial({ color })
      );
      m.position.set(pos.x, pos.y, pos.z);
      const dir = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        Math.random() * 1.6 + 0.2,
        (Math.random() - 0.5) * 2
      ).normalize();
      this._add(m, 0.35, {
        vel: dir.multiplyScalar(2 + Math.random() * 2.5),
        grav: kind === 'blood',
        fade: true,
        userData: { opacity: 0.95 },
      });
    }
  }

  shell(pos, dir) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.018, 0.018, 0.04),
      new THREE.MeshStandardMaterial({ color: 0xd8a23f, metalness: 0.8, roughness: 0.3 })
    );
    m.position.set(pos.x, pos.y, pos.z);
    this._add(m, 0.8, {
      vel: {
        x: dir.x * (1 + Math.random()) + (Math.random() - 0.5),
        y: 1.6 + Math.random() * 0.7,
        z: dir.z * (1 + Math.random()) + (Math.random() - 0.5),
      },
      grav: true,
      spin: 8 + Math.random() * 6,
    });
  }

  explosion(pos) {
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.95 })
    );
    flash.position.set(pos.x, pos.y + 0.3, pos.z);
    this._add(flash, 0.22, { grow: 18, fade: true, userData: { opacity: 0.95 } });
    const light = new THREE.PointLight(0xffa63d, 300, 26, 2);
    light.position.set(pos.x, pos.y + 1, pos.z);
    this._add(light, 0.3, {
      onDone: (it) => { it.mesh.intensity = 0; },
      userData: { light: true },
    });
    // 冲击环
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.75, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
    );
    ring.position.set(pos.x, pos.y + 0.2, pos.z);
    ring.rotation.x = -Math.PI / 2;
    this._add(ring, 0.3, { grow: 30, fade: true, userData: { opacity: 0.8 } });
    // 烟雾
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(0.4, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0x3a3a34, transparent: true, opacity: 0.32 })
      );
      s.position.set(pos.x + (Math.random() - 0.5) * 0.5, pos.y + 0.3, pos.z + (Math.random() - 0.5) * 0.5);
      this._add(s, 1.1, {
        vel: { x: (Math.random() - 0.5) * 1.4, y: 1.2 + Math.random() * 1.6, z: (Math.random() - 0.5) * 1.4 },
        grow: 1.4,
        fade: true,
        userData: { opacity: 0.32 },
      });
    }
  }

  plantBeacon(pos) {
    const sprite = this._flashSprite();
    sprite.position.set(pos.x, pos.y + 1.6, pos.z);
    sprite.scale.set(1.6, 1.6, 1);
    sprite.material.color.setHex(0xff5533);
    this._add(sprite, 1.6, { fade: true, userData: { opacity: 0.5 } });
  }
}
