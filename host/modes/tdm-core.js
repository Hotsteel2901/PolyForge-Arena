// 团队死斗状态机：计分、时间到 / 达标结束。纯数据，不碰玩家对象。

export class TdmRound {
  constructor({ scoreLimit = 60, duration = 420, onEvent = () => {} } = {}) {
    this.scoreLimit = scoreLimit;
    this.duration = duration;
    this.onEvent = onEvent;
    this.state = 'idle';
    this.timeLeft = duration;
    this.scores = { CT: 0, T: 0 };
    this.winner = null;
    this.reason = null;
  }

  start() {
    this.state = 'live';
    this.timeLeft = this.duration;
    this.scores = { CT: 0, T: 0 };
    this.winner = null;
    this.reason = null;
    this.onEvent({ type: 'round_start', scores: { ...this.scores }, scoreLimit: this.scoreLimit });
  }

  update(dt) {
    if (this.state !== 'live') return null;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      const { CT, T } = this.scores;
      if (CT === T) this.end('DRAW', 'timeout');
      else this.end(CT > T ? 'CT' : 'T', 'timeout');
      return { type: 'time_end' };
    }
    return null;
  }

  // 返回最新比分；达标时内部直接结算
  addKill(teamKey) {
    if (this.state !== 'live') return this.scores;
    if (this.scores[teamKey] === undefined) return this.scores;
    this.scores[teamKey] += 1;
    if (this.scores[teamKey] >= this.scoreLimit) this.end(teamKey, 'score');
    return this.scores;
  }

  end(winner, reason) {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.winner = winner;
    this.reason = reason;
    this.onEvent({ type: 'round_end', winner, reason, scores: { ...this.scores } });
  }
}
