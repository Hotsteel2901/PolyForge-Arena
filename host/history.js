// 玩家位置历史：用于射击倒带（延迟补偿）。只读快照，不修改玩家状态。

export class PositionHistory {
  constructor({ maxAge = 1.2, maxEntries = 64 } = {}) {
    this.maxAge = maxAge;
    this.maxEntries = maxEntries;
    this.entries = [];
  }

  push(time, data) {
    this.entries.push({ time, data });
    if (this.entries.length > this.maxEntries) this.entries.shift();
  }

  // 返回时间 <= time 的最近快照；若没有则返回 null（不返回未来快照）
  get(time) {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].time <= time + 1e-4) return this.entries[i].data;
    }
    return null;
  }

  prune(now) {
    while (this.entries.length && this.entries[0].time < now - this.maxAge) {
      this.entries.shift();
    }
  }
}
