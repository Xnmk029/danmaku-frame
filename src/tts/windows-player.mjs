import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 写入音频文件（序号文件，首次创建通常不会冲突；失败时删旧重试）。 */
async function writeWithRetry(filePath, data, maxAttempts = 8) {
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      fs.writeFileSync(filePath, data);
      return;
    } catch (error) {
      lastError = error;
      const retryable = error.code === 'EBUSY' || error.code === 'EPERM'
        || /EBUSY|busy|locked|being used/i.test(error.message);
      if (!retryable || attempt === maxAttempts - 1) throw error;
      await sleep(250 * (attempt + 1));
    }
  }
  throw lastError;
}

/**
 * Windows 常驻播放器：管理 scripts/tts-player.ps1 子进程。
 * 每次播放使用【唯一序号文件】current-<n>.mp3 —— 绕开 WPF MediaPlayer 对
 * 相同 URI 的媒体会话缓存（同名覆盖播放会一直输出第一次的内容）。
 * 串行队列：发 PLAY <n> 后等待 DONE/ERROR 再进入下一条。
 */
export class WindowsPlayer {
  constructor({
    audioDir,
    scriptFile,
    volume = 1.0,
    powershell = 'powershell.exe',
  }) {
    this.audioDir = audioDir;
    this.scriptFile = scriptFile;
    this.volume = volume;
    this.powershell = powershell;
    this.proc = null;
    this.pending = null; // { resolve, reject, timer }
    this.lineBuffer = '';
    this.started = false;
    this.playCount = 0;
  }

  get available() {
    return this.started && this.proc !== null && this.proc.exitCode === null;
  }

  async start() {
    fs.mkdirSync(this.audioDir, { recursive: true });
    await this.spawnProcess();
  }

  spawnProcess() {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.powershell, [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-File', this.scriptFile,
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          TTS_AUDIO_DIR: this.audioDir,
          TTS_VOLUME: String(this.volume),
        },
      });
      this.proc = proc;
      this.lineBuffer = '';

      let readyTimer = setTimeout(() => {
        reject(new Error('播放器进程启动超时'));
      }, 15_000);

      const onData = chunk => {
        this.lineBuffer += chunk.toString('utf8');
        let newlineIndex;
        while ((newlineIndex = this.lineBuffer.indexOf('\n')) >= 0) {
          const line = this.lineBuffer.slice(0, newlineIndex).replace(/\r$/, '');
          this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1);
          this.handleLine(line);
          if (line === 'READY' && readyTimer) {
            clearTimeout(readyTimer);
            readyTimer = null;
            this.started = true;
            resolve();
          }
        }
      };
      proc.stdout.on('data', onData);
      proc.stderr.on('data', chunk => {
        const text = chunk.toString('utf8').trim();
        if (text) console.error('[TTS-Player]', text);
      });
      proc.on('error', error => {
        if (readyTimer) {
          clearTimeout(readyTimer);
          readyTimer = null;
          reject(error);
        } else {
          console.error('[TTS-Player] 播放器进程异常:', error.message);
          this.settlePending(new Error(`播放器进程异常: ${error.message}`));
        }
      });
      proc.on('exit', code => {
        if (readyTimer) {
          clearTimeout(readyTimer);
          readyTimer = null;
          reject(new Error(`播放器进程提前退出 (code=${code})`));
        } else {
          this.settlePending(new Error(`播放器进程退出 (code=${code})`));
        }
      });
    });
  }

  handleLine(line) {
    if (line === 'DONE') {
      this.settlePending(null);
    } else if (line.startsWith('ERROR ')) {
      this.settlePending(new Error(line.slice(6) || '未知播放错误'));
    } else if (line.startsWith('DEV_VOL ') || line.startsWith('DEV_FIXED ') || line.startsWith('SES_VOL ') || line.startsWith('SES_FIXED ')) {
      // 播放器音频设备/会话音量自检与自愈报告
      this.lastSessionVolume = line;
      console.log(`[TTS-Player] 音频状态: ${line}`);
    }
    // READY / 其他行忽略
  }

  settlePending(error) {
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    if (error) pending.reject(error);
    else pending.resolve();
  }

  writeLine(line) {
    if (!this.available) throw new Error('播放器未就绪');
    this.proc.stdin.write(`${line}\n`);
  }

  /**
   * 播放一段音频：写入唯一序号文件（绕开 MediaPlayer URI 缓存），发 PLAY <n>。
   * 播放完成后清理更早的序号文件。
   * @param {Buffer} mp3Data
   * @returns {Promise<void>} 播放完成（或出错）后 resolve/reject
   */
  async play(mp3Data) {
    if (!this.available) await this.spawnProcess();
    // 串行保护：上一条未结束则等待
    while (this.pending) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (this.pending) throw new Error('播放队列冲突');

    // 唯一序号文件：current-<seq>.mp3（不同 URI → 每次全新媒体会话）
    const seq = (this.seq = (this.seq || 0) + 1);
    const filePath = path.join(this.audioDir, `current-${seq}.mp3`);
    await writeWithRetry(filePath, mp3Data);

    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error('播放超时（播放器无响应）'));
      }, 200_000);
      this.pending = { resolve, reject, timer };
    });
    try {
      this.writeLine(`PLAY ${seq}`);
    } catch (error) {
      this.settlePending(error);
      throw error;
    }
    const previousSeq = seq - 1;
    if (previousSeq > 0) {
      // 上一条已播完，清理旧文件（异步、失败无害）
      setTimeout(() => {
        try { fs.unlinkSync(path.join(this.audioDir, `current-${previousSeq}.mp3`)); } catch { /* ignore */ }
      }, 2000).unref?.();
    }
    this.playCount += 1;
    return promise;
  }

  /** 跳过当前播放。 */
  stop() {
    if (!this.available) return;
    try {
      this.writeLine('STOP');
    } catch (error) {
      console.error('[TTS-Player] stop 失败:', error.message);
    }
  }

  /** 运行时更新播放音量（0-1），下次播放生效。 */
  setVolume(volume) {
    const next = Math.min(1, Math.max(0, Number(volume) || 0));
    this.volume = next;
    if (this.available) {
      try {
        this.writeLine(`VOLUME ${next}`);
      } catch (error) {
        console.error('[TTS-Player] 音量设置失败:', error.message);
      }
    }
  }

  /** 停止并退出播放器进程。 */
  async close() {
    const proc = this.proc;
    this.proc = null;
    if (!proc || proc.exitCode !== null) return;
    try {
      this.writeLine('EXIT');
    } catch {
      // ignore
    }
    await new Promise(resolve => {
      const timer = setTimeout(() => {
        try { proc.kill(); } catch { /* ignore */ }
        resolve();
      }, 3_000);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}