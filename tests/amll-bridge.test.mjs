import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import { PlaybackAggregator } from '../src/ncm/amll-core.mjs';
import { AmllBridge } from '../src/ncm/amll-bridge.mjs';

/* ============ PlaybackAggregator（协议解析与状态聚合） ============ */

test('setMusic aggregates song metadata and emits playback', () => {
  const agg = new PlaybackAggregator();
  const events = [];
  agg.on('playback', e => events.push(e));

  agg.handleStateUpdate({
    update: 'setMusic',
    musicId: '28967124',
    musicName: '告白气球',
    albumId: '35001785',
    albumName: '周杰伦的床边故事',
    artists: [{ id: '6452', name: '周杰伦' }],
    duration: 217000,
  });

  assert.equal(events.length, 1);
  const snap = events[0];
  assert.equal(snap.playing, true);
  assert.equal(snap.song.name, '告白气球');
  assert.deepEqual(snap.song.artists, ['周杰伦']);
  assert.equal(snap.song.duration, 217000);
  assert.equal(snap.song.albumName, '周杰伦的床边故事');
});

test('progress changes below 500ms are throttled, larger ones broadcast', () => {
  const agg = new PlaybackAggregator();
  const events = [];
  agg.on('playback', e => events.push(e));
  agg.handleStateUpdate({ update: 'setMusic', musicId: '1', musicName: 'A', artists: [], duration: 10000 });

  agg.handleStateUpdate({ update: 'progress', progress: 200 });
  assert.equal(events.length, 1, 'small progress delta is throttled');

  agg.handleStateUpdate({ update: 'progress', progress: 3200 });
  assert.equal(events.length, 2, 'large progress delta broadcasts');
  assert.equal(events[1].progress, 3200);
});

test('paused / resumed toggle status', () => {
  const agg = new PlaybackAggregator();
  const events = [];
  agg.on('playback', e => events.push(e));
  agg.handleStateUpdate({ update: 'setMusic', musicId: '1', musicName: 'A', artists: [], duration: 1000 });

  agg.handleStateUpdate({ update: 'paused' });
  assert.equal(events.at(-1).paused, true);
  assert.equal(events.at(-1).playing, false);

  agg.handleStateUpdate({ update: 'resumed' });
  assert.equal(events.at(-1).playing, true);
});

test('switch song resets progress and updates song', () => {
  const agg = new PlaybackAggregator();
  const events = [];
  agg.on('playback', e => events.push(e));
  agg.handleStateUpdate({ update: 'setMusic', musicId: '1', musicName: 'A', artists: [], duration: 1000 });
  agg.handleStateUpdate({ update: 'progress', progress: 8000 });

  agg.handleStateUpdate({ update: 'setMusic', musicId: '2', musicName: 'B', artists: [], duration: 2000 });
  const last = events.at(-1);
  assert.equal(last.song.name, 'B');
  assert.equal(last.progress, 0, 'progress resets on song change');
});

test('data cover is cached with id, uri cover passes url through', () => {
  const agg = new PlaybackAggregator();
  agg.handleStateUpdate({ update: 'setMusic', musicId: '1', musicName: 'A', artists: [], duration: 1000 });

  agg.handleStateUpdate({ update: 'setCover', source: 'uri', url: 'https://p3.music.126.net/cover.png' });
  let snap = agg.snapshot();
  assert.equal(snap.cover.kind, 'uri');
  assert.equal(snap.cover.url, 'https://p3.music.126.net/cover.png');

  agg.handleStateUpdate({ update: 'setCover', source: 'data', image: { mimeType: 'image/png', data: 'aGVsbG8=' } });
  snap = agg.snapshot();
  assert.equal(snap.cover.kind, 'data');
  assert.ok(snap.cover.id, 'data cover gets an id');
  assert.equal(snap.cover.url, undefined, 'data payload not broadcast');

  const cached = agg.getCoverData(snap.cover.id);
  assert.equal(cached.mime, 'image/png');
  assert.equal(cached.data, 'aGVsbG8=');
});

test('snapshot without song is empty and non-playing', () => {
  const agg = new PlaybackAggregator();
  const snap = agg.snapshot();
  assert.equal(snap.playing, false);
  assert.equal(snap.song, null);
  assert.equal(snap.cover, null);
});

test('non-state updates are ignored', () => {
  const agg = new PlaybackAggregator();
  let fired = 0;
  agg.on('playback', () => fired++);
  agg.handleStateUpdate({ update: 'modeChanged', repeat: 'all', shuffle: true });
  agg.handleStateUpdate(null);
  agg.handleStateUpdate('junk');
  assert.equal(fired, 0);
});

/* ============ AmllBridge（WS 客户端薄壳） ============ */

class FakeSocket extends EventEmitter {
  static instances = [];
  constructor(url) {
    super();
    this.url = url;
    this.sent = [];
    FakeSocket.instances.push(this);
  }
  send(payload) { this.sent.push(payload); }
  close() { this.emit('close'); }
}

test('client mode connects and sends initialize per protocol', () => {
  FakeSocket.instances.length = 0;
  const bridge = new AmllBridge({ WebSocketImpl: FakeSocket, reconnectDelayMs: 50 });
  bridge.start();
  const sock = FakeSocket.instances[0];
  assert.ok(sock);
  sock.emit('open');
  assert.equal(bridge.active, true);
  assert.deepEqual(JSON.parse(sock.sent[0]), { type: 'initialize' });
  bridge.stop();
});

test('client mode retries after connection failure', async () => {
  FakeSocket.instances.length = 0;
  const bridge = new AmllBridge({ WebSocketImpl: FakeSocket, reconnectDelayMs: 40 });
  const offline = [];
  bridge.on('offline', () => offline.push(1));
  bridge.start();
  FakeSocket.instances[0].emit('close');
  await new Promise(r => setTimeout(r, 100));
  assert.equal(FakeSocket.instances.length >= 2, true, 'reconnects');
  assert.equal(offline.length, 1);
  bridge.stop();
});
