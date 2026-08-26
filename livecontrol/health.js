// 健康监控：3s 轮询所有服务
const net = require('net');

class HealthMonitor {
  constructor(runtimes) {
    this.runtimes = runtimes;
    this.timer = null;
  }

  start() {
    this.pollAll();
    this.timer = setInterval(() => this.pollAll(), 3000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async pollAll() {
    for (const rt of this.runtimes) {
      const healthy = await this.pollOne(rt);
      if (rt.healthy !== healthy) {
        rt.healthy = healthy;
        // 进程活着但健康失败 → degraded
        if (rt.alive && !healthy && rt.state === 'running') {
          rt.state = 'degraded';
          rt.emit('state', rt);
        } else if (healthy && rt.state === 'degraded') {
          rt.state = 'running';
          rt.emit('state', rt);
        } else {
          rt.emit('state', rt); // 通知 healthy 变化
        }
      }
    }
  }

  async pollOne(rt) {
    const def = rt.def;
    if (!rt.alive) return false;
    try {
      switch (def.health) {
        case 'http':
          return await this._probeHttp(def.url);
        case 'tcp':
          return await this._probeTcp(def.port);
        default:
          return true;
      }
    } catch {
      return false;
    }
  }

  async _probeHttp(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  _probeTcp(port) {
    return new Promise((resolve) => {
      const sock = net.connect({ host: '127.0.0.1', port }, () => {
        sock.destroy();
        resolve(true);
      });
      sock.on('error', () => resolve(false));
      sock.setTimeout(1200, () => { sock.destroy(); resolve(false); });
    });
  }
}

module.exports = { HealthMonitor };
