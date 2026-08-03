import { spawnSync } from 'child_process';

const VIRTUAL_KEYS = {
  previous: '0xB1',
  next: '0xB0',
  playPause: '0xB3',
};

export class WindowsMediaController {
  constructor({ enabled = false, platform = process.platform } = {}) {
    this.enabled = enabled;
    this.platform = platform;
  }

  press(action) {
    if (!this.enabled || this.platform !== 'win32') return false;
    const virtualKey = VIRTUAL_KEYS[action];
    if (!virtualKey) throw new Error(`不支持的媒体键操作: ${action}`);

    const script = [
      'Add-Type -TypeDefinition',
      `'using System; using System.Runtime.InteropServices; public class MK {`,
      `[DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, IntPtr extra); }'`,
      `[MK]::keybd_event(${virtualKey},0,0,[IntPtr]::Zero);`,
      `[MK]::keybd_event(${virtualKey},0,2,[IntPtr]::Zero)`,
    ].join(' ');
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { encoding: 'utf8', timeout: 5_000, windowsHide: true },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr?.trim() || `PowerShell 退出码 ${result.status}`);
    return true;
  }
}
