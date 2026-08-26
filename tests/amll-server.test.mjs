import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { AmllServer } from '../src/ncm/amll-server.mjs';

async function startServer(port = 0) {
  const server = new AmllServer({ port, host: '127.0.0.1' });
  await server.start();
  const actualPort = port === 0 ? server.server.address().port : port;
  return { server, actualPort };
}

function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function send(ws, type, value) {
  ws.send(JSON.stringify(value === undefined ? { type } : { type, value }));
}

test('server accepts a connector, emits online and aggregates state', async () => {
  const { server, actualPort } = await startServer();
  try {
    const events = [];
    server.on('playback', e => events.push(e));
    const online = [];
    server.on('online', () => online.push(1));

    const ws = await connect(actualPort);
    await new Promise(r => setTimeout(r, 50));
    assert.equal(online.length, 1, 'online fired on first connection');
    assert.equal(server.active, true);

    send(ws, 'initialize');
    send(ws, 'state', {
      update: 'setMusic',
      musicId: '28967124',
      musicName: '告白气球',
      albumId: '35001785',
      albumName: '周杰伦的床边故事',
      artists: [{ id: '6452', name: '周杰伦' }],
      duration: 217000,
    });
    await new Promise(r => setTimeout(r, 80));

    assert.equal(events.length, 1);
    assert.equal(events[0].song.name, '告白气球');
    assert.equal(events[0].playing, true);

    ws.close();
  } finally {
    server.stop();
  }
});

test('server streams cover, progress and paused states', async () => {
  const { server, actualPort } = await startServer();
  try {
    const events = [];
    server.on('playback', e => events.push(e));
    const ws = await connect(actualPort);

    send(ws, 'state', { update: 'setMusic', musicId: '1', musicName: 'A', artists: [], duration: 10000 });
    send(ws, 'state', { update: 'setCover', source: 'data', image: { mimeType: 'image/png', data: 'aGVsbG8=' } });
    send(ws, 'state', { update: 'progress', progress: 5000 });
    send(ws, 'state', { update: 'paused' });
    await new Promise(r => setTimeout(r, 80));

    const last = events.at(-1);
    assert.equal(last.paused, true);
    assert.equal(last.progress, 5000);
    const snap = server.snapshot();
    assert.equal(snap.cover.kind, 'data');
    assert.ok(server.getCoverData(snap.cover.id), 'cover cached');
    ws.close();
  } finally {
    server.stop();
  }
});

test('server emits offline when last client disconnects', async () => {
  const { server, actualPort } = await startServer();
  try {
    const offline = [];
    server.on('offline', () => offline.push(1));
    const ws = await connect(actualPort);
    await new Promise(r => setTimeout(r, 30));
    ws.close();
    // 事件驱动轮询等待（避免并行负载下的时序抖动）
    const deadline = Date.now() + 2_000;
    while (offline.length === 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 20));
    }
    assert.equal(offline.length, 1);
    assert.equal(server.active, false);
  } finally {
    server.stop();
  }
});

test('malformed messages are ignored without crashing', async () => {
  const { server, actualPort } = await startServer();
  try {
    const ws = await connect(actualPort);
    ws.send('not-json{{{');
    ws.send(JSON.stringify({ type: 'state', value: { update: 'modeChanged' } }));
    await new Promise(r => setTimeout(r, 30));
    assert.equal(server.snapshot().song, null);
    ws.close();
  } finally {
    server.stop();
  }
});

test('stop closes all connections', async () => {
  const { server, actualPort } = await startServer();
  const ws = await connect(actualPort);
  await new Promise(r => setTimeout(r, 30));
  server.stop();
  await new Promise(r => setTimeout(r, 30));
  assert.equal(server.active, false);
  try { ws.close(); } catch { /* ignore */ }
});
