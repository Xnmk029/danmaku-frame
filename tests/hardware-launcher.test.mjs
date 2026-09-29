import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureHardware } from '../src/transport/hardware-launcher.mjs';

const base = { root: 'G:/产品/OBS/danmaku-frame', platform: 'win32', env: { SystemRoot: 'C:/Windows' } };

test('hardware startup reuses the LiveControl sampler instead of spawning a duplicate', async () => {
  const result = await ensureHardware({ ...base,
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, service: 'phase-hardware' }) }),
    execFileImpl: () => assert.fail('must reuse a healthy sampler'),
  });
  assert.equal(result.status, 'running');
});

test('hardware startup restores the missing sidecar with the guarded hidden launcher', async () => {
  let called = false;
  const result = await ensureHardware({ ...base,
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    execFileImpl: (file, args, options, callback) => {
      called = true;
      assert.ok(file.endsWith('powershell.exe'));
      assert.ok(args.at(-1).endsWith('start-hardware.ps1'));
      assert.equal(options.windowsHide, true);
      assert.equal(options.cwd, base.root);
      callback(null, 'ready', '');
    },
  });
  assert.equal(called, true);
  assert.equal(result.status, 'started');
});

test('occupied port errors are reported and do not stop unrelated processes', async () => {
  const result = await ensureHardware({ ...base,
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, service: 'other' }) }),
    execFileImpl: (_file, _args, _options, callback) => callback(new Error('occupied'), '', 'Port 7790 is occupied'),
  });
  assert.equal(result.status, 'error');
  assert.match(result.message, /occupied/);
});

test('hardware autostart respects opt-out and skips non-Windows platforms', async () => {
  const forbidden = () => assert.fail('disabled startup must not probe or spawn');
  for (const options of [{ platform: 'linux' }, { env: { PHASE_HARDWARE_AUTOSTART: 'false' } }]) {
    const result = await ensureHardware({ ...base, ...options, fetchImpl: forbidden, execFileImpl: forbidden });
    assert.equal(result.status, 'disabled');
  }
});
