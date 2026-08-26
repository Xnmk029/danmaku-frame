// 服务定义 + 进程管理（ServiceRuntime）
const { spawn, execFile } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');

const PRODUCT_ROOT = 'G:/产品';
const OBS_ROOT = path.join(PRODUCT_ROOT, 'OBS');
const VUP_ROOT = path.join(PRODUCT_ROOT, 'vup');

// ---------------- 服务定义 ----------------
const SERVICE_DEFS = [
  {
    id: 'danmaku',
    name: '弹幕姬',
    desc: 'B站弹幕 H5 边框 · 点歌姬 · 朗读 · 中继 (7788/7789) · 守护重启',
    icon: 'forum',
    file: 'node',
    args: ['supervisor.mjs'],
    cwd: path.join(OBS_ROOT, 'danmaku-frame'),
    health: 'http',
    url: 'http://127.0.0.1:7788/healthz',
    killPorts: [7788, 7789],
    readyTimeout: 25,
    chain: 30,
  },
  {
    id: 'pigeon',
    name: '鸽子动画',
    desc: 'OBS 场景中鸽子素材左右折返滚动动画',
    icon: 'motion_photos_on',
    file: 'node',
    args: ['scratch/animate_pigeons.mjs'],
    cwd: OBS_ROOT,
    health: 'process',
    readyTimeout: 15,
    chain: 40,
  },
  {
    id: 'whale-rgb',
    name: '鲸鱼RGB',
    desc: '大鲸鱼图层色相扫描 RGB 流光滤镜（OBS WebSocket，速度 °/s 可调）',
    icon: 'palette',
    file: 'node',
    args: ['scratch/animate-whale-rgb.mjs'],
    cwd: OBS_ROOT,
    health: 'process',
    readyTimeout: 15,
  },
  {
    id: 'facetrack',
    name: '面捕追踪',
    desc: 'OpenSeeFace 人脸追踪 → UDP 127.0.0.1:11573',
    icon: 'center_focus_strong',
    file: path.join(VUP_ROOT, 'OpenSeeFace', 'Binary', 'facetracker.exe'),
    args: () => {
      const f = global.__faceConfig || { capture: '0', fps: 24, model: 3, visualize: true, maxThreads: 4 };
      const args = ['--capture', String(f.capture), '--fps', String(f.fps), '--model', String(f.model),
                    '--faces', '1', '--ip', '127.0.0.1', '--port', '11573'];
      if (f.visualize) args.push('--visualize', '1', '--pnp-points', '1');
      else args.push('--visualize', '0');
      args.push('--max-threads', String(f.maxThreads || 4));
      return args;
    },
    cwd: path.join(VUP_ROOT, 'OpenSeeFace'),
    health: 'process',
    readyTimeout: 20,
    chain: 10,
  },
  {
    id: 'avatar',
    name: '虚拟形象',
    desc: 'Live2D Lite 播放器（绿幕窗口，供 OBS 窗口采集）',
    icon: 'accessibility_new',
    file: path.join(VUP_ROOT, 'Live2DPlayer', 'Native', 'Live2DPlayer.exe'),
    args: [path.join(VUP_ROOT, 'Live2DPlayer', 'Resources', 'v3', 'DS蓝鸽', 'DS蓝鸽.model3.json')],
    cwd: path.join(VUP_ROOT, 'Live2DPlayer'),
    health: 'process',
    readyTimeout: 15,
    chain: 20,
  },
];

// ---------------- 状态 ----------------
const State = {
  Stopped: 'stopped',
  Starting: 'starting',
  Running: 'running',
  Stopping: 'stopping',
  Degraded: 'degraded',
  Error: 'error',
};

const STATE_LABEL = {
  stopped: '已停止',
  starting: '启动中…',
  running: '运行中',
  stopping: '停止中…',
  degraded: '异常',
  error: '已崩溃',
};

// ---------------- 工具：杀端口占用 + 等待端口释放 -------------
function killPortOccupiers(ports) {
  return new Promise((resolve) => {
    if (!ports || !ports.length) return resolve();
    execFile('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve();
      const pids = new Set();
      for (const line of stdout.split(/\r?\n/)) {
        if (!/LISTENING/i.test(line)) continue;
        if (!ports.some((p) => line.includes(`:${p} `) || line.includes(`:${p}\t`))) continue;
        const m = line.trim().split(/\s+/);
        const pid = parseInt(m[m.length - 1], 10);
        if (pid > 0 && pid !== process.pid) pids.add(pid);
      }
      for (const pid of pids) {
        try { process.kill(pid); } catch { /* 已退出 */ }
      }
      resolve();
    });
  });
}

/** 轮询等待目标端口不再被 LISTENING（Windows 强杀后 socket 释放有延迟） */
function waitPortsReleased(ports, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (!ports || !ports.length) return resolve();
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      execFile('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true }, (err, stdout) => {
        if (err) return resolve();
        const stillListening = ports.some((p) =>
          stdout.split(/\r?\n/).some((line) =>
            /LISTENING/i.test(line) && (line.includes(`:${p} `) || line.includes(`:${p}\t`))),
        );
        if (!stillListening || Date.now() >= deadline) return resolve();
        setTimeout(check, 200);
      });
    };
    check();
  });
}

function killTree(pid) {
  return new Promise((resolve) => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

// ---------------- ServiceRuntime ----------------
class ServiceRuntime extends EventEmitter {
  constructor(def) {
    super();
    this.def = def;
    this.child = null;
    this.state = State.Stopped;
    this.healthy = false;
    this.startedAt = null;
    this._stoppingExpected = false;
    this._logs = [];
    this._maxLogs = 5000;
  }

  get alive() { return this.child !== null && this.child.exitCode === null; }

  start() {
    if (this.alive) return true;
    (async () => {
      await killPortOccupiers(this.def.killPorts);
      // 关键：等待端口真正释放后再启动，避免 Windows 下旧 socket 未释放导致 EACCES 绑定失败
      await waitPortsReleased(this.def.killPorts);
      this._stoppingExpected = false;
      try {
        const args = typeof this.def.args === 'function' ? this.def.args() : this.def.args;
        const child = spawn(this.def.file, args, {
          cwd: this.def.cwd,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        this.child = child;
        this.startedAt = new Date();
        this._setState(State.Starting);
        this._log(`进程已启动 (PID ${child.pid})`);

        const pump = (chunk) => {
          for (const line of chunk.toString('utf8').replace(/\r\n/g, '\n').split('\n')) {
            if (line) this._log(line);
          }
        };
        child.stdout.on('data', pump);
        child.stderr.on('data', pump);
        child.on('exit', (code) => {
          this.child = null;
          if (!this._stoppingExpected) {
            this._setState(State.Error);
            this._log(`进程非预期退出，ExitCode=${code}`);
          } else {
            this._setState(State.Stopped);
            this._log('进程已停止');
          }
        });
        child.on('error', (err) => {
          this._setState(State.Error);
          this._log(`启动异常：${err.message}`);
        });
        return true;
      } catch (err) {
        this._setState(State.Error);
        this._log(`启动异常：${err.message}`);
        return false;
      }
    })();
    return true;
  }

  stop() {
    if (!this.alive) return;
    this._stoppingExpected = true;
    this._setState(State.Stopping);
    const pid = this.child.pid;
    killTree(pid);
  }

  kill() {
    if (this.alive) killTree(this.child.pid);
  }

  _setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.emit('state', this);
  }

  _log(line) {
    const stamped = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${line}`;
    this._logs.push(stamped);
    if (this._logs.length > this._maxLogs) this._logs.splice(0, this._logs.length - this._maxLogs);
    this.emit('log', this, stamped);
  }

  clearLog() { this._logs = []; }

  snapshot() {
    return {
      id: this.def.id,
      name: this.def.name,
      desc: this.def.desc,
      icon: this.def.icon,
      state: this.state,
      stateLabel: STATE_LABEL[this.state] || this.state,
      healthy: this.healthy,
      pid: this.child ? this.child.pid : null,
      startedAt: this.startedAt ? this.startedAt.toISOString() : null,
      logs: this._logs.slice(-500),
    };
  }
}

module.exports = { SERVICE_DEFS, ServiceRuntime, State, killTree };
