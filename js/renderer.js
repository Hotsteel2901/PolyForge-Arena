// 渲染器（Ultra Edition）：三点动态布光、太阳圆盘天空穹顶、PMREM 金属环境反射、
// 四档画质（低/中/高/极致）与色彩曝光风格预设。

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
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.08, 280);
    this.pixelRatio = Math.min(devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(innerWidth, innerHeight);
    this.quality = 'high';
    this.colorStyle = 'classic';
    this.sun = null;
    this.rim = null;
    this.hemi = null;
    this.lights = [];
    this.vmLight = null;
    addEventListener('resize', () => this.resize());
  }

  setupSky({ top, bottom, fog, near: skyNear = 24, far: skyFar = 165 }) {
    if (this.sky) {
      this.scene.remove(this.sky);
      this.sky = null;
    }
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#' + top.toString(16).padStart(6, '0'));
    g.addColorStop(0.58, '#' + bottom.toString(16).padStart(6, '0'));
    g.addColorStop(1, '#' + fog.toString(16).padStart(6, '0'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    // 太阳高光散射圆盘
    const sunGrad = ctx.createRadialGradient(185, 58, 3, 185, 58, 56);
    sunGrad.addColorStop(0, 'rgba(255,250,230,0.92)');
    sunGrad.addColorStop(0.28, 'rgba(255,236,195,0.34)');
    sunGrad.addColorStop(1, 'rgba(255,236,195,0)');
    ctx.fillStyle = sunGrad;
    ctx.fillRect(0, 0, 256, 256);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(250, 28, 16),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false })
    );
    this.sky = sky;
    this.scene.add(sky);
    this.scene.fog = new THREE.Fog(fog, skyNear, skyFar);
    this.scene.background = new THREE.Color(fog);
    this.addEnvironment(top, bottom);
  }

  addEnvironment(top = 0x2b4f8f, bottom = 0xbcd7ee) {
    try {
      const w = 128;
      const h = 64;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#' + top.toString(16).padStart(6, '0'));
      grad.addColorStop(0.48, '#' + bottom.toString(16).padStart(6, '0'));
      grad.addColorStop(0.52, '#7d8a84');
      grad.addColorStop(1, '#333f3a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      const sun = ctx.createRadialGradient(w * 0.72, h * 0.18, 2, w * 0.72, h * 0.18, h * 0.55);
      sun.addColorStop(0, 'rgba(255,248,225,0.98)');
      sun.addColorStop(1, 'rgba(255,245,215,0)');
      ctx.fillStyle = sun;
      ctx.fillRect(0, 0, w, h);

      const eq = new THREE.CanvasTexture(c);
      eq.mapping = THREE.EquirectangularReflectionMapping;
      eq.colorSpace = THREE.SRGBColorSpace;
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const env = pmrem.fromEquirectangular(eq).texture;
      if (this.envMap) this.envMap.dispose();
      this.envMap = env;
      this.scene.environment = env;
      this.scene.environmentIntensity = 0.68;
      eq.dispose();
      pmrem.dispose();
    } catch (err) {
      console.warn('[renderer] env map failed', err);
      this.scene.environment = null;
    }
  }

  setupLights(map = null) {
    if (this.hemi) this.scene.remove(this.hemi);
    if (this.sun) this.scene.remove(this.sun);
    if (this.rim) this.scene.remove(this.rim);
    if (this.ambient) this.scene.remove(this.ambient);
    const L = (map && map.lighting) || {};
    this.hemi = new THREE.HemisphereLight(0xcbe2ff, 0x54635c, L.hemi ?? 1.02);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(L.sunColor ?? 0xfff2d6, L.sun ?? 2.45);
    this.sun.position.set(42, 56, 26);
    this.sun.castShadow = true;
    const sz = this.quality === 'ultra' ? 2048 : this.quality === 'high' ? 2048 : this.quality === 'medium' ? 1024 : 512;
    this.sun.shadow.mapSize.set(sz, sz);
    this.sun.shadow.camera.left = -54;
    this.sun.shadow.camera.right = 54;
    this.sun.shadow.camera.top = 54;
    this.sun.shadow.camera.bottom = -54;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 155;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // 反向轮廓补光（让暗面角色与武器立体感大幅提升）
    this.rim = new THREE.DirectionalLight(0x7cc8ff, 0.58);
    this.rim.position.set(-34, 24, -30);
    this.scene.add(this.rim);

    this.ambient = new THREE.AmbientLight(0xffffff, L.ambient ?? 0.08);
    this.scene.add(this.ambient);
  }

  applySettings({ shadow = true, quality = 'high', colorStyle = 'classic' } = {}) {
    this.quality = quality;
    this.colorStyle = colorStyle;
    this.renderer.shadowMap.enabled = shadow;
    if (this.sun) this.sun.castShadow = shadow;
    const ratio = quality === 'ultra' ? Math.min(devicePixelRatio || 1, 2)
      : quality === 'high' ? Math.min(devicePixelRatio || 1, 1.75)
        : quality === 'medium' ? 1.35 : 1;
    this.renderer.setPixelRatio(ratio);
    const size = quality === 'ultra' ? 2048 : quality === 'high' ? 2048 : quality === 'medium' ? 1024 : 512;
    if (this.sun) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
    // 色彩滤镜与曝光预设
    if (colorStyle === 'cyber') {
      this.renderer.toneMappingExposure = 1.15;
      this.canvas.style.filter = 'contrast(1.08) saturate(1.22)';
    } else if (colorStyle === 'cinema') {
      this.renderer.toneMappingExposure = 1.02;
      this.canvas.style.filter = 'contrast(1.10) saturate(0.92)';
    } else if (colorStyle === 'warm') {
      this.renderer.toneMappingExposure = 1.08;
      this.canvas.style.filter = 'contrast(1.04) saturate(1.12) sepia(0.08)';
    } else {
      this.renderer.toneMappingExposure = 1.06;
      this.canvas.style.filter = '';
    }
  }

  setupViewmodelLight() {
    if (this.vmLight) return this.vmLight;
    const light = new THREE.PointLight(0xfff4e2, 1.85, 2.4, 1.4);
    light.position.set(0.28, 0.22, 0.16);
    this.camera.add(light);
    this.vmLight = light;
    return light;
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
