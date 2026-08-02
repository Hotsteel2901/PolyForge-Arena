// 拆弹回合纯状态机：胜负规则与炸弹计时。

export class DefusalRound {
  constructor({ roundTime = 105, bombTime = 40, onEvent = () => {} } = {}) {
    this.roundTime = roundTime;
    this.bombTime = bombTime;
    this.onEvent = onEvent;
    this.state = 'idle';
    this.timeLeft = roundTime;
    this.bombTimeLeft = bombTime;
    this.bombPlanted = false;
    this.bombPos = null;
    this.winner = null;
    this.reason = null;
  }

  start({ tAlive, ctAlive, bombCarrier }) {
    this.state = 'live';
    this.timeLeft = this.roundTime;
    this.bombTimeLeft = this.bombTime;
    this.bombPlanted = false;
    this.bombPos = null;
    this.winner = null;
    this.reason = null;
    this.onEvent({ type: 'round_start', tAlive, ctAlive, bombCarrier });
  }

  update(dt) {
    if (this.state !== 'live') return null;
    this.timeLeft -= dt;
    if (this.bombPlanted) {
      this.bombTimeLeft -= dt;
      if (this.bombTimeLeft <= 0) {
        this.onEvent({ type: 'bomb_exploded' });
        this.end('T', 'explosion', { exploded: true });
        return { type: 'bomb_exploded' };
      }
    } else if (this.timeLeft <= 0) {
      this.end('CT', 'timeout');
      return { type: 'round_timeout' };
    }
    return null;
  }

  plantBomb(pos) {
    if (this.state !== 'live' || this.bombPlanted) return false;
    this.bombPlanted = true;
    this.bombPos = pos;
    this.onEvent({ type: 'bomb_planted', pos });
    return true;
  }

  defuseBomb() {
    if (this.state !== 'live' || !this.bombPlanted) return false;
    this.end('CT', 'defused');
    return true;
  }

  forceExplode() {
    this.end('T', 'explosion', { exploded: true });
  }

  teamEliminated(team) {
    this.end(team === 'T' ? 'CT' : 'T', 'elimination');
  }

  end(winner, reason, extra = {}) {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.winner = winner;
    this.reason = reason;
    this.onEvent({ type: 'round_end', winner, reason, ...extra });
  }
}
