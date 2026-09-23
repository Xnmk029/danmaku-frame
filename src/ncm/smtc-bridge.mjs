import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const helper = fileURLToPath(new URL('../../scripts/smtc-watch.ps1', import.meta.url));

export class SmtcBridge extends EventEmitter {
  constructor({ appPattern = 'cloudmusic|netease|网易云', intervalMs = 1000, spawnImpl = spawn, platform = process.platform } = {}) {
    super();
    Object.assign(this, { appPattern, intervalMs, spawnImpl, platform });
    this.running = false;
    this.connected = false;
    this.frame = null;
    this.cover = null;
    this.diagnostic = { status: 'stopped', message: 'SMTC 未启动' };
  }
  get active() { return this.connected; }
  snapshot() { return this.frame || { type: 'ncm.playback', source: 'smtc', playing: false, paused: false, song: null, cover: null, progress: 0 }; }
  getCoverData(id) { return this.cover?.id === id ? this.cover : null; }

  accept(frame) {
    if (frame?.type !== 'smtc') return;
    this.lastSeen = Date.now();
    if (!frame.available || !String(frame.title || '').trim() || !['playing', 'paused'].includes(frame.status)) {
      this.diagnostic = { status: frame.error ? 'error' : 'waiting', message: frame.error || '等待网易云 SMTC 播放信息', sessions: frame.sessions || [] };
      this.clear();
      return;
    }
    const wasActive = this.active;
    const id = `smtc-${hash(JSON.stringify([frame.sourceApp, frame.title, frame.artist, frame.album]))}`;
    const duration = Math.max(0, Number(frame.duration) || 0);
    const progress = Math.max(0, Number(frame.progress) || 0);
    this.cover = null;
    if (/^image\/(png|jpeg|gif|webp)$/.test(frame.cover?.mime) && typeof frame.cover?.data === 'string' && frame.cover.data.length <= 2_800_000) {
      this.cover = { ...frame.cover, kind: 'data', id: `smtc-cover-${hash(frame.cover.data)}` };
    }
    this.frame = {
      type: 'ncm.playback', source: 'smtc', playing: frame.status === 'playing', paused: frame.status === 'paused',
      song: { id, name: String(frame.title), albumName: String(frame.album || ''), artists: frame.artist ? [String(frame.artist)] : [], duration },
      cover: this.cover ? { kind: 'data', id: this.cover.id } : null,
      progress: duration ? Math.min(duration, progress) : progress, updatedAt: Date.now(),
    };
    this.connected = true;
    this.diagnostic = { status: 'active', sourceApp: String(frame.sourceApp || '') };
    if (!wasActive) this.emit('online');
    this.emit('playback', this.snapshot());
  }

  clear() {
    const wasActive = this.connected;
    this.connected = false;
    this.frame = null;
    this.cover = null;
    if (wasActive) this.emit('offline');
  }
  start() {
    if (this.running) return;
    if (this.platform !== 'win32') {
      this.diagnostic = { status: 'unsupported', message: 'SMTC 需要 Windows 10 1809 或更新版本' };
      return;
    }
    this.running = true;
    this.launch();
    this.watchdog = setInterval(() => {
      if (this.child && Date.now() - this.lastSeen > 20_000) {
        this.diagnostic = { status: 'error', message: 'SMTC 读取超时，正在重启读取进程' };
        this.clear();
        this.child.kill();
      }
    }, 5000);
    this.watchdog.unref?.();
  }
  launch() {
    if (!this.running) return;
    this.lastSeen = Date.now();
    this.diagnostic = { status: 'starting', message: '正在读取 Windows 媒体会话' };
    const executable = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const child = this.spawnImpl(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
      '-AppPattern', this.appPattern, '-IntervalMs', String(this.intervalMs), '-OwnerProcessId', String(process.pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (this.child !== child) return;
      buffer += chunk;
      if (buffer.length > 4_000_000) { buffer = ''; child.kill(); return; }
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
        try { this.accept(JSON.parse(line)); } catch { /* Ignore malformed helper output. */ }
      }
    });
    child.stderr.on('data', () => { this.diagnostic = { status: 'error', message: 'SMTC 读取进程报错，正在重试' }; });
    child.on('error', () => { this.diagnostic = { status: 'error', message: '无法启动 Windows SMTC 读取进程' }; });
    child.on('close', () => {
      if (this.child !== child) return;
      this.child = null;
      this.clear();
      if (this.running) { this.retry = setTimeout(() => this.launch(), 5000); this.retry.unref?.(); }
    });
  }
  stop() {
    this.running = false;
    clearTimeout(this.retry); clearInterval(this.watchdog);
    const child = this.child; this.child = null;
    child?.kill();
    this.clear();
    this.diagnostic = { status: 'stopped', message: 'SMTC 未启动' };
  }
}
