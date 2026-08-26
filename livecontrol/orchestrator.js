// 联动编排：一键开播（按 chain 顺序 + 等待就绪）/ 一键下播（逆序停止）
const { EventEmitter } = require('events');

class Orchestrator extends EventEmitter {
  constructor(runtimes, health) {
    super();
    this.runtimes = runtimes;
    this.health = health;
    this.busy = false;
    this.currentStep = '';
  }

  startStream() { return this._run(true); }
  stopStream() { return this._run(false); }

  async _run(start) {
    if (this.busy) return;
    this.busy = true;
    const label = start ? '开播' : '下播';
    this._step(`${label}序列开始`);
    try {
      const chain = this.runtimes
        .slice()
        .sort((a, b) => (start ? a.def.chain - b.def.chain : b.def.chain - a.def.chain));
      for (const rt of chain) {
        const action = start ? '启动' : '停止';
        this._step(`${action}「${rt.def.name}」`);
        if (start) {
          rt.start();
          await this._waitReady(rt);
        } else {
          rt.stop();
        }
      }
      this._step(`${label}序列完成`);
    } catch (err) {
      this._step(`${label}序列异常：${err.message}`);
    } finally {
      this.busy = false;
      this.currentStep = '';
      this.emit('finished');
    }
  }

  _step(text) {
    this.currentStep = text;
    this.emit('step', text);
  }

  async _waitReady(rt) {
    const deadline = Date.now() + rt.def.readyTimeout * 1000;
    while (Date.now() < deadline) {
      if (rt.healthy) return;
      if (!rt.alive && rt.state === 'error') return; // 启动失败，继续下一步
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

module.exports = { Orchestrator };
