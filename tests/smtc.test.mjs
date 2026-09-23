import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { SmtcBridge } from '../src/ncm/smtc-bridge.mjs';
import { NowPlaying } from '../src/ncm/now-playing.mjs';

const frame = { type: 'smtc', available: true, sourceApp: 'cloudmusic.exe', title: '歌曲', artist: '歌手', album: '专辑', status: 'playing', duration: 180000, progress: 32000, cover: { mime: 'image/jpeg', data: 'aGVsbG8=' } };

test('SMTC maps metadata, milliseconds, pause, resume, cover and track changes', () => {
  const bridge = new SmtcBridge();
  bridge.accept(frame);
  const first = bridge.snapshot();
  assert.equal(first.song.name, '歌曲');
  assert.deepEqual(first.song.artists, ['歌手']);
  assert.equal(first.song.duration, 180000);
  assert.equal(first.progress, 32000);
  assert.equal(bridge.getCoverData(first.cover.id).data, 'aGVsbG8=');
  assert.equal(JSON.stringify(first).includes('aGVsbG8='), false);
  bridge.accept({ ...frame, status: 'paused' });
  assert.equal(bridge.snapshot().paused, true);
  assert.equal(bridge.snapshot().playing, false);
  bridge.accept({ ...frame, title: '下一首', cover: null, progress: 0 });
  assert.notEqual(bridge.snapshot().song.id, first.song.id);
  assert.equal(bridge.snapshot().cover, null);
  assert.equal(bridge.getCoverData(first.cover.id), null);
  bridge.accept({ type: 'smtc', available: false });
  assert.equal(bridge.active, false);
  assert.equal(bridge.snapshot().song, null);
});

test('SMTC helper handles split JSON lines, duplicate starts and child cleanup', () => {
  let spawns = 0; let kills = 0;
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => kills++;
  const bridge = new SmtcBridge({ platform: 'win32', spawnImpl: (executable, args, options) => {
    spawns++; assert.match(executable, /powershell.exe$/); assert.equal(options.windowsHide, true);
    assert.ok(args.includes('-AppPattern')); return child;
  } });
  try {
    bridge.start(); bridge.start();
    const line = JSON.stringify(frame) + '\n';
    child.stdout.write(line.slice(0, 20));
    assert.equal(bridge.active, false);
    child.stdout.write(line.slice(20));
    assert.equal(bridge.active, true);
    assert.equal(spawns, 1);
  } finally { bridge.stop(); }
  assert.equal(kills, 1);
  assert.equal(bridge.running, false);
});

test('SMTC is nonfatal on unsupported platforms', () => {
  const bridge = new SmtcBridge({ platform: 'linux', spawnImpl: () => assert.fail('must not spawn') });
  bridge.start(); assert.equal(bridge.diagnostic.status, 'unsupported');
});

function source() {
  const s = new EventEmitter();
  s.active = false;
  s.starts = 0;
  s.start = () => { s.starts++; };
  s.stop = () => { s.active = false; s.emit('offline'); };
  s.snapshot = () => ({ type: 'ncm.playback', playing: true, song: { name: s.name }, cover: { id: s.name } });
  s.getCoverData = id => id === s.name ? { data: s.name } : null;
  s.publish = name => { s.name = name; s.active = true; s.emit('playback'); };
  return s;
}

test('automatic mode selects AMLL, falls back to SMTC, and ignores stale reconnect data', async () => {
  const amll = source(), smtc = source();
  const now = new NowPlaying({ amll, smtc });
  let offline = 0; now.on('offline', () => offline++);
  await now.start(); await now.start();
  assert.equal(amll.starts, 1); assert.equal(smtc.starts, 1);
  smtc.publish('SMTC'); assert.equal(now.snapshot().source, 'smtc');
  amll.publish('AMLL'); assert.equal(now.snapshot().source, 'amll');
  amll.stop(); assert.equal(now.snapshot().source, 'smtc'); assert.equal(offline, 0);
  amll.active = true; amll.emit('online');
  assert.equal(now.snapshot().source, 'smtc');
  assert.deepEqual(now.getCoverData('SMTC'), { data: 'SMTC' });
  assert.equal(now.getCoverData('AMLL'), null);
  now.stop(); assert.equal(offline, 1); assert.equal(now.active, false);
});

test('forced SMTC does not start AMLL; AMLL failure does not block automatic SMTC', async () => {
  const amll = source(), smtc = source();
  const now = new NowPlaying({ amll, smtc, source: 'smtc' });
  await now.start(); assert.equal(amll.starts, 0); now.stop();
  amll.start = async () => { throw new Error('port occupied'); };
  const auto = new NowPlaying({ amll, smtc });
  await auto.start(); smtc.publish('fallback');
  assert.equal(auto.snapshot().source, 'smtc'); auto.stop();
});
