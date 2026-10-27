// 军备竞赛（Gun Game）状态机：全场自由混战，每击杀一次升级武器，匕首击杀夺冠。
// 只维护计时与结算；等级推进由 Room 负责（需要改玩家装备并同步给客户端）。

export class GunGameRound {
  constructor({ duration = 600, ladder = [], onEvent = () => {} } = {}) {
    this.duration = duration;
    this.ladder = ladder;
    this.onEvent = onEvent;
    this.state = 'idle';
    this.timeLeft = duration;
    this.winnerId = null;
    this.winnerName = null;
    this.reason = null;
  }

  get maxLevel() {
    return Math.max(0, this.ladder.length - 1);
  }

  start() {
    this.state = 'live';
    this.timeLeft = this.duration;
    this.winnerId = null;
    this.winnerName = null;
    this.reason = null;
    this.onEvent({ type: 'round_start', ladder: this.ladder, duration: this.duration });
  }

  update(dt) {
    if (this.state !== 'live') return null;
    this.timeLeft -= dt;
    // 时间到不自动结算：由 Room 取最高等级者裁决（并列则比击杀数）
    return this.timeLeft <= 0 ? { type: 'time_end' } : null;
  }

  end(winnerId, winnerName, reason) {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.winnerId = winnerId;
    this.winnerName = winnerName;
    this.reason = reason;
    this.onEvent({ type: 'round_end', winner: 'FFA', winnerId, winnerName, reason });
  }
}
