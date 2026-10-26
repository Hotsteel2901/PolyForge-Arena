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
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    // r185 起 PCFSoftShadowMap 已弃用（内部会回落到 PCF），直接用 PCF 避免控制台告警
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 260);
    this.pixelRatio = Math.min(devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(innerWidth, innerHeight);
    this.quality = 'high';
    this.sun = null;
    this.hemi = null;
    this.lights = [];
    this.vmLight = null;
    addEventListener('resize', () => this.resize());
  }

  setupSky({ top, bottom, fog, near: skyNear = 22, far: skyFar = 150 }) {
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
    this.scene.fog = new THREE.Fog(fog, skyNear, skyFar);
    this.scene.background = new THREE.Color(fog);
    this.addEnvironment(c);
  }

  // 环境反射：枪械/护甲用的是高 metalness 材质，没有 environment 会渲染成"死黑块"。
  // 用同一张天空渐变生成 PMREM 环境贴图，金属才有高光层次（成本一次性，之后零开销）。
  addEnvironment(skyCanvas) {
    try {
      // 必须用 2:1 的等距柱状投影画布：天空球用的是 16×512 的竖向条带，
      // 直接当 equirect 喂给 PMREM 会因为宽高比极端、mip 塌缩，最终环境贴图近乎全黑，
      // 金属枪械自然就渲染成一块死黑的剪影。
      const w = 128;
      const h = 64;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      // 上半球：天空（取天空球贴图顶部的颜色），下半球：地面反射
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#cfe4ff');
      grad.addColorStop(0.48, '#e8f2ff');
      grad.addColorStop(0.52, '#7d8a7a');
      grad.addColorStop(1, '#3d4a3c');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      // 一点方位变化，避免环境只有上下渐变、金属没有任何方向感
      const sun = ctx.createRadialGradient(w * 0.72, h * 0.18, 2, w * 0.72, h * 0.18, h * 0.55);
      sun.addColorStop(0, 'rgba(255,245,215,0.95)');
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
      this.scene.environmentIntensity = 0.55;
      eq.dispose();
      pmrem.dispose();
    } catch (err) {
      // 环境贴图生成失败不影响主渲染（老设备上 PMREM 可能超时）
      console.warn('[renderer] env map failed', err);
      this.scene.environment = null;
    }
  }

  // 光照强度允许按地图覆盖：室内图没有天空补光，纯靠默认值会黑成一片
  setupLights(map = null) {
    if (this.hemi) this.scene.remove(this.hemi);
    if (this.sun) this.scene.remove(this.sun);
    if (this.ambient) this.scene.remove(this.ambient);
    const L = (map && map.lighting) || {};
    // 地面色别调太暗：多层地图的天桥/平台底面完全靠半球光的下半球补光，
    // 旧值 0x33443a 会让桥底变成一块纯黑。
    this.hemi = new THREE.HemisphereLight(0xbdd7ff, 0x54635a, L.hemi ?? 0.95);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d0, L.sun ?? 2.35);
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
    this.ambient = new THREE.AmbientLight(0xffffff, L.ambient ?? 0.06);
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

  // 第一人称专用补光：挂在相机上，只照近距离（distance 2m）。
  // 场景光对 0.5m 处的枪身几乎是个"掠射角"，金属材质会整块发黑；
  // 贴脸补一盏暖光后，枪身结构、手部、弹匣高光才看得出来。
  setupViewmodelLight() {
    if (this.vmLight) return this.vmLight;
    const light = new THREE.PointLight(0xfff0dc, 1.6, 2.0, 1.6);
    light.position.set(0.28, 0.18, 0.15);
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
