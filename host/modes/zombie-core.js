// 生化模式纯状态机：感染传播与胜负。

export class ZombieMatch {
  constructor({ duration = 420, onEvent = () => {} } = {}) {
    this.duration = duration;
    this.onEvent = onEvent;
    this.state = 'idle';
    this.timeLeft = duration;
    this.humans = 0;
    this.zombies = 0;
    this.winner = null;
    this.reason = null;
  }

  start({ humans, zombies }) {
    this.state = 'live';
    this.timeLeft = this.duration;
    this.humans = humans.length;
    this.zombies = zombies.length;
    this.winner = null;
    this.reason = null;
    this.onEvent({ type: 'round_start', humans, zombies });
  }

  update(dt) {
    if (this.state !== 'live') return null;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      if (this.humans > 0) {
        this.end('HUMAN', 'survived');
        return { type: 'time_end' };
      }
      this.end('ZOMBIE', 'infected_all');
      return { type: 'infected_all' };
    }
    return null;
  }

  infect(playerId) {
    if (this.state !== 'live' || this.humans <= 0) return false;
    this.humans -= 1;
    this.zombies += 1;
    this.onEvent({ type: 'infected', playerId });
    if (this.humans <= 0) this.end('ZOMBIE', 'infected_all');
    return true;
  }

  end(winner, reason) {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.winner = winner;
    this.reason = reason;
    this.onEvent({ type: 'round_end', winner, reason });
  }
}
