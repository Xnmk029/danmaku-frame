import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * 弹幕机 Supervisor —— 崩溃自动重启守护进程。
 *
 * 启动方式：node supervisor.mjs（替代直接 node server.mjs）
 * 行为：
 *   - 子进程正常退出（exit code 0，如 Ctrl+C 优雅退出）→ Supervisor 一并退出，不重启。
 *   - 子进程崩溃（exit code != 0）→ 读取自动重启开关，开启则指数退避重启。
 *   - 关闭开关：data/auto-restart.json 写入 {"enabled":false}，或用 .env AUTO_RESTART_ENABLED=false。
 *   - 熔断保护：连续崩溃 8 次停止重启（防崩溃循环烧机）。
 */

const WORKER_FILE = process.env.SUPERVISOR_WORKER
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs');
const SWITCH_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'data', 'auto-restart.json');
const MAX_CONSECUTIVE_FAILURES = 8;
const STABLE_UPTIME_MS = 60_000; // 稳定运行超过该时长则重置连续失败计数
const MAX_DELAY_MS = 30_000;

function envBoolean(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

/** 读取自动重启开关：优先运行时文件（data/auto-restart.json），否则 .env 默认。 */
export function isAutoRestartEnabled() {
  try {
    if (fs.existsSync(SWITCH_FILE)) {
      const payload = JSON.parse(fs.readFileSync(SWITCH_FILE, 'utf8'));
      return payload.enabled !== false;
    }
  } catch (error) {
    console.error('[Supervisor] 读取自动重启开关失败:', error.message);
  }
  return envBoolean('AUTO_RESTART_ENABLED', true);
}

let child = null;
let consecutiveFailures = 0;
let startedAt = 0;
let stopping = false;

/** 探测 7788 是否已被其他弹幕姬实例服务（避免多 supervisor 打架）。 */
async function danmakuAlreadyServed() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch('http://127.0.0.1:7788/healthz', { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/** 若已有实例在服务，则本实例退出（不再循环抢端口）。返回 true 表示已退出。 */
async function yieldToExistingInstance(context) {
  if (await danmakuAlreadyServed()) {
    console.log(`[Supervisor] ${context}：检测到 7788 已有弹幕姬实例在服务，本守护实例退出（避免双重管理）。`);
    process.exit(0);
    return true;
  }
  return false;
}

function startWorker() {
  if (stopping) return;
  startedAt = Date.now();
  const proc = spawn(process.execPath, [WORKER_FILE], {
    stdio: 'inherit',
    env: process.env,
  });
  child = proc;

  proc.on('error', error => {
    console.error('[Supervisor] 启动子进程失败:', error.message);
    if (!stopping) {
      consecutiveFailures += 1;
      scheduleRestart();
    }
  });

  proc.on('exit', (code, signal) => {
    child = null;
    if (stopping) {
      console.log('[Supervisor] 已停止。');
      process.exit(0);
      return;
    }

    const uptime = Date.now() - startedAt;
    const crashed = code !== 0;
    const interrupted = signal === 'SIGINT' || signal === 'SIGTERM';

    if (!crashed || interrupted) {
      console.log(`[Supervisor] 子进程退出 (code=${code}, signal=${signal})，Supervisor 退出。`);
      process.exit(0);
      return;
    }

    if (uptime >= STABLE_UPTIME_MS) consecutiveFailures = 0;
    consecutiveFailures += 1;

    if (!isAutoRestartEnabled()) {
      console.error('[Supervisor] 检测到崩溃，但“崩溃自动重启”已关闭（data/auto-restart.json 或 .env AUTO_RESTART_ENABLED=false）。不重启。');
      process.exit(1);
      return;
    }

    if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
      console.error(`[Supervisor] 连续崩溃 ${consecutiveFailures - 1} 次，触发熔断保护，停止自动重启。请人工检查后手动启动。`);
      process.exit(1);
      return;
    }

    scheduleRestart();
  });
}

function scheduleRestart() {
  const delay = Math.min(1000 * 2 ** (consecutiveFailures - 1), MAX_DELAY_MS);
  console.log(`[Supervisor] ${delay}ms 后重启弹幕机（第 ${consecutiveFailures} 次失败）...`);
  setTimeout(async () => {
    // 重启前：若端口已被其他实例接管（如 LiveControl 重启的），本实例让位退出
    if (await yieldToExistingInstance('重启前检查')) return;
    startWorker();
  }, delay);
}

// 优雅退出：转发信号后退出等待子进程 exit
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[Supervisor] 收到 ${signal}，通知子进程退出...`);
  if (child) {
    try {
      child.kill(signal === 'SIGINT' ? 'SIGINT' : 'SIGTERM');
    } catch {
      process.exit(0);
    }
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', error => {
  console.error('[Supervisor] 未捕获异常:', error);
  process.exit(1);
});

console.log('[Supervisor] 弹幕机守护进程启动。崩溃自动重启开关:', isAutoRestartEnabled() ? 'ON' : 'OFF');
// 启动前检查：若已有实例在服务（如 LiveControl 正在管理），本实例让位退出
yieldToExistingInstance('启动前检查').then(yielded => {
  if (!yielded) startWorker();
});