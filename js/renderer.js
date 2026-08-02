// 渲染器：场景、相机、光照、天空、阴影。

import * as THREE from 'three';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 260);
    this.pixelRatio = Math.min(devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(innerWidth, innerHeight);
    this.quality = 'high';
    this.sun = null;
    this.hemi = null;
    this.lights = [];
    addEventListener('resize', () => this.resize());
  }

  setupSky({ top, bottom, fog }) {
    if (this.sky) {
      this.scene.remove(this.sky);
      this.sky = null;
    }
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 512;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#' + top.toString(16).padStart(6, '0'));
    g.addColorStop(1, '#' + bottom.toString(16).padStart(6, '0'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 512);
    const tex = new THREE.CanvasTexture(c);
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(240, 24, 12),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false })
    );
    this.sky = sky;
    this.scene.add(sky);
    this.scene.fog = new THREE.Fog(fog, 22, 150);
    this.scene.background = new THREE.Color(fog);
  }

  setupLights() {
    if (this.hemi) this.scene.remove(this.hemi);
    if (this.sun) this.scene.remove(this.sun);
    if (this.ambient) this.scene.remove(this.ambient);
    this.hemi = new THREE.HemisphereLight(0xbdd7ff, 0x33443a, 1.05);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d0, 2.6);
    this.sun.position.set(38, 52, 22);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -50;
    this.sun.shadow.camera.right = 50;
    this.sun.shadow.camera.top = 50;
    this.sun.shadow.camera.bottom = -50;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 140;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.12);
    this.scene.add(this.ambient);
  }

  applySettings({ shadow = true, quality = 'high' } = {}) {
    this.quality = quality;
    this.renderer.shadowMap.enabled = shadow;
    if (this.sun) this.sun.castShadow = shadow;
    const ratio = quality === 'high' ? Math.min(devicePixelRatio || 1, 2) : quality === 'medium' ? 1.5 : 1;
    this.renderer.setPixelRatio(ratio);
    const size = quality === 'high' ? 2048 : quality === 'medium' ? 1024 : 512;
    if (this.sun) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
  }

  addLight(light) {
    this.lights.push(light);
    this.scene.add(light);
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
