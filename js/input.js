// 键鼠输入：指针锁定、按键状态、输入帧打包。

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.yaw = 0;
    this.pitch = 0;
    this.fire = false;
    this.ads = false;
    this.reloadQueued = false;
    this.switchQueued = -1;
    this.swdQueued = 0;
    this.useQueued = false;
    this.useHeld = false;
    this.swdQueued = 0;
    this.crouchHeld = false;
    this.onSwitch = null;
    this.onWheel = null;
    this.jumpQueued = false;
    this.scoreboard = false;
    this.chatOpen = false;
    this.locked = false;
    this.skillQueued = false;
    this.sensitivity = 1;
    this.invertY = false;
    this.fov = 75;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mvTouch = null;
    this.bound = {
      keydown: (e) => this.keydown(e),
      keyup: (e) => {
        this.keys.delete(e.code);
        if (e.code === 'Tab') this.scoreboard = false; // 松开 Tab 关闭记分板
      },
      mousemove: (e) => this.mousemove(e),
      mousedown: (e) => this.mousedown(e),
      mouseup: (e) => this.mouseup(e),
      wheel: (e) => this.wheel(e),
      lockchange: () => { this.locked = document.pointerLockElement === this.canvas; },
    };
  }

  attach() {
    window.addEventListener('keydown', this.bound.keydown);
    window.addEventListener('keyup', this.bound.keyup);
    document.addEventListener('mousemove', this.bound.mousemove);
    document.addEventListener('mousedown', this.bound.mousedown);
    document.addEventListener('mouseup', this.bound.mouseup);
    document.addEventListener('wheel', this.bound.wheel, { passive: true });
    document.addEventListener('pointerlockchange', this.bound.lockchange);
  }

  detach() {
    window.removeEventListener('keydown', this.bound.keydown);
    window.removeEventListener('keyup', this.bound.keyup);
    document.removeEventListener('mousemove', this.bound.mousemove);
    document.removeEventListener('mousedown', this.bound.mousedown);
    document.removeEventListener('mouseup', this.bound.mouseup);
    document.removeEventListener('wheel', this.bound.wheel);
    document.removeEventListener('pointerlockchange', this.bound.lockchange);
  }

  requestLock() {
    if (this.isTouchPrimary()) return; // 触屏为主设备用触控 UI，不请求指针锁定
    if (document.pointerLockElement === this.canvas) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      // 移动端/不支持的环境：忽略
    }
  }

  // 触屏为主的设备（无悬停）跳过指针锁定；触屏笔记本/混合设备保留鼠标指针锁定。
  isTouchPrimary() {
    if (('ontouchstart' in window) || navigator.maxTouchPoints > 0) {
      if (window.matchMedia && window.matchMedia('(hover: hover)').matches) return false;
      return true;
    }
    return false;
  }

  keydown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Enter' && !this.chatOpen && document.getElementById('chat-input').classList.contains('hidden')) {
      // 打开聊天由 HUD 处理
    }
    if (e.code === 'KeyR') this.reloadQueued = true;
    if (e.code === 'KeyF') this.skillQueued = true; // 丧尸加速技能
    if (e.code === 'KeyE') this.useQueued = true;
    if (e.code === 'Space') this.jumpQueued = true;
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= 4) {
        this.switchQueued = n - 1;
        if (this.onSwitch) this.onSwitch(n - 1); // 事件同步本地切枪，不等下一帧
      }
    }
    if (e.code === 'Tab') {
      this.scoreboard = true;
      e.preventDefault();
    }
    this.keys.add(e.code);
    if (this.locked && ['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  }

  mousemove(e) {
    if (!this.locked || this.chatOpen) return;
    const sens = 0.0022 * this.sensitivity;
    this.yaw -= e.movementX * sens;
    this.pitch -= e.movementY * sens * (this.invertY ? -1 : 1);
    if (this.pitch > 1.55) this.pitch = 1.55;
    if (this.pitch < -1.55) this.pitch = -1.55;
  }

  mousedown(e) {
    if (e.button === 0) this.fire = true;
    if (e.button === 2) this.ads = true;
  }

  mouseup(e) {
    if (e.button === 0) this.fire = false;
    if (e.button === 2) this.ads = false;
  }

  wheel(e) {
    if (this.locked && !this.chatOpen) {
      const dir = e.deltaY > 0 ? 1 : -1;
      this.swdQueued = dir;
      if (this.onWheel) this.onWheel(dir);
    }
  }

  consume() {
    const mv = this.mvTouch || [
      this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0,
      this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0,
      this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0,
      this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0,
    ];
    const frame = {
      mv,
      j: this.jumpQueued ? 1 : 0,
      s: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 1 : 0,
      c: (this.keys.has('ControlLeft') || this.keys.has('KeyC') || this.crouchHeld) ? 1 : 0,
      yaw: this.yaw,
      pitch: this.pitch,
      fire: this.fire ? 1 : 0,
      ads: this.ads ? 1 : 0,
      r: this.reloadQueued ? 1 : 0,
      sw: this.switchQueued >= 0 ? this.switchQueued : -1,
      swd: this.swdQueued || 0,
      u: (this.useHeld || this.useQueued || this.keys.has('KeyE')) ? 1 : 0,
      skill: this.skillQueued ? 1 : 0,
    };
    return frame;
  }

  // 输入帧真正发送成功后才清空边沿队列（避免按键落在发送节流帧之间被吞掉）
  clearEdges() {
    this.reloadQueued = false;
    this.switchQueued = -1;
    this.swdQueued = 0;
    this.useQueued = false;
    this.jumpQueued = false;
    this.skillQueued = false;
  }
}
