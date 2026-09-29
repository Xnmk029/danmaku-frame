import { execFile } from 'node:child_process';
import path from 'node:path';

/** Ensure the independent sampler is running without restarting the relay.
 * The PowerShell launcher checks port ownership and never stops a listener.
 * An existing LiveControl-managed sampler is reused.
 */
export async function ensureHardware({
  root,
  platform = process.platform,
  env = process.env,
  fetchImpl = globalThis.fetch,
  execFileImpl = execFile,
} = {}) {
  if (platform !== 'win32' || /^(false|0|off)$/i.test(env.PHASE_HARDWARE_AUTOSTART || '')) {
    return { status: 'disabled' };
  }
  try {
    const response = await fetchImpl('http://127.0.0.1:7790/healthz', {
      signal: AbortSignal.timeout(1500), cache: 'no-store',
    });
    const state = await response.json();
    if (response.ok && state.ok && state.service === 'phase-hardware') {
      return { status: 'running' };
    }
  } catch { /* The sampler may not have been started after a reboot. */ }

  const shell = path.join(env.SystemRoot || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = path.join(root, 'scripts', 'start-hardware.ps1');
  return new Promise(resolve => {
    execFileImpl(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { cwd: root, windowsHide: true, timeout: 20_000, env }, (error, stdout, stderr) => {
        resolve(error
          ? { status: 'error', message: String(stderr || error.message).trim() }
          : { status: 'started', message: String(stdout).trim() });
      });
  });
}
