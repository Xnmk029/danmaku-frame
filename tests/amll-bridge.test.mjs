import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import { AmllBridge } from '../src/ncm/amll-bridge.mjs';

/** 假 WebSocket：捕获构造参数，暴露事件触发与发送记录 */
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

function makeBridge({ url = 'ws://127.0.0.1:11444' } = {}) {
  FakeSocket.instances.length = 0;
  const bridge = new AmllBridge({ url, WebSocketImpl: FakeSocket, reconnectDelayMs: 50 });
  return bridge;
}

function openFirst() {
  const sock = FakeSocket.instances[0];
  assert.ok(sock, 'should have created a socket');
  sock.emit('open');
  return sock;
}

function pushState(sock, value) {
  sock.emit('message', Buffer.from(JSON.stringify({ type: 'state', value })));
}

test('connects and sends initialize per protocol', () => {
  const bridge = makeBridge();
  bridge.start();
  const sock = openFirst();
  assert.equal(bridge.active, true);
  assert.deepEqual(JSON.parse(sock.sent[0]), { type: 'initialize' });
  bridge.stop();
});

test('setMusic aggregates song metadata and emits playback', () => {
  const bridge = makeBridge();
  const events = [];
  bridge.on('playback', e => events.push(e));
  bridge.start();
  const sock = openFirst();

  pushState(sock, {
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
  bridge.stop();
});

test('progress changes below 500ms are throttled, larger ones broadcast', () => {
  const bridge = makeBridge();
  const events = [];
  bridge.on('playback', e => events.push(e));
  bridge.start();
  const sock = openFirst();
  pushState(sock, { update: 'setMusic', musicId: '1', musicName: 'A', artists: [], duration: 10000 });

  pushState(sock, { update: 'progress', progress: 200 });
  assert.equal(events.length, 1, 'small progress delta is throttled');

  pushState(sock, { update: 'progress', progress: 3200 });
  assert.equal(events.length, 2, 'large progress delta broadcasts');
  assert.equal(events[1].progress, 3200);
  bridge.stop();
});

test('paused / resumed toggle status', () => {
  const bridge = makeBridge();
  const events = [];
  bridge.on('playback', e => events.push(e));
  bridge.start();
  const sock = openFirst();
  pushState(sock, { update: 'setMusic', musicId: '1', musicName: 'A', artists: [], duration: 1000 });

  pushState(sock, { update: 'paused' });
  assert.equal(events.at(-1).paused, true);
  assert.equal(events.at(-1).playing, false);

  pushState(sock, { update: 'resumed' });
  assert.equal(events.at(-1).playing, true);
  bridge.stop();
});

test('switch song resets progress and updates song', () => {
  const bridge = makeBridge();
  const events = [];
  bridge.on('playback', e => events.push(e));
  bridge.start();
  const sock = openFirst();
  pushState(sock, { update: 'setMusic', musicId: '1', musicName: 'A', artists: [], duration: 1000 });
  pushState(sock, { update: 'progress', progress: 8000 });

  pushState(sock, { update: 'setMusic', musicId: '2', musicName: 'B', artists: [], duration: 2000 });
  const last = events.at(-1);
  assert.equal(last.song.name, 'B');
  assert.equal(last.progress, 0, 'progress resets on song change');
  bridge.stop();
});

test('data cover is cached with id, uri cover passes url through', () => {
  const bridge = makeBridge();
  bridge.start();
  const sock = openFirst();
  pushState(sock, { update: 'setMusic', musicId: '1', musicName: 'A', artists: [], duration: 1000 });

  pushState(sock, { update: 'setCover', source: 'uri', url: 'https://p3.music.126.net/cover.png' });
  let snap = bridge.snapshot();
  assert.equal(snap.cover.kind, 'uri');
  assert.equal(snap.cover.url, 'https://p3.music.126.net/cover.png');

  pushState(sock, { update: 'setCover', source: 'data', image: { mimeType: 'image/png', data: 'aGVsbG8=' } });
  snap = bridge.snapshot();
  assert.equal(snap.cover.kind, 'data');
  assert.ok(snap.cover.id, 'data cover gets an id');
  assert.equal(snap.cover.url, undefined, 'data payload not broadcast');

  const cached = bridge.getCoverData(snap.cover.id);
  assert.equal(cached.mime, 'image/png');
  assert.equal(cached.data, 'aGVsbG8=');
  bridge.stop();
});

test('connection failure emits offline and retries', async () => {
  const bridge = makeBridge();
  const offline = [];
  bridge.on('offline', () => offline.push(1));
  bridge.start();
  // 构造时抛错 → 走重连路径
  assert.equal(offline.length, 0);
  // 模拟连接失败：socket close
  openFirst().emit('close');
  await new Promise(r => setTimeout(r, 120));
  assert.equal(FakeSocket.instances.length >= 2, true, 'reconnects');
  assert.equal(offline.length, 1);
  bridge.stop();
});

test('snapshot without song is empty and non-playing', () => {
  const bridge = makeBridge();
  const snap = bridge.snapshot();
  assert.equal(snap.playing, false);
  assert.equal(snap.song, null);
  assert.equal(snap.cover, null);
});
