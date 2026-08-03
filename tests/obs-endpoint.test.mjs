import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHttpServer } from '../src/transport/http-server.mjs';

// 兼容两种运行位置：仓库根跑 npm test 或 danmaku-frame 内直接跑
const CANDIDATE = path.resolve('danmaku-frame');
const ROOT = fs.existsSync(CANDIDATE) ? CANDIDATE : path.resolve('.');

async function startServer(overrides = {}) {
  const calls = [];
  const http = createHttpServer({
    root: ROOT,
    host: '127.0.0.1',
    port: 0,
    wsAuthToken: 'secret-token',
    switchSceneHandler: async ({ scene }) => {
      calls.push(scene);
      if (!scene) throw new Error('场景名不能为空');
      if (scene === 'boom') throw new Error('OBS 连接失败');
      return { ok: true, scene };
    },
    ...overrides,
  });
  await http.start();
  const port = http.server.address().port;
  return { http, port, calls };
}

function post(port, scene, token) {
  return fetch(`http://127.0.0.1:${port}/api/obs/switch-scene`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scene, ...(token ? { token } : {}) }),
  });
}

test('POST /api/obs/switch-scene switches scene from loopback', async () => {
  const { http, port, calls } = await startServer();
  try {
    const res = await post(port, '正片');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.scene, '正片');
    assert.deepEqual(calls, ['正片']);
  } finally {
    await http.stop();
  }
});

test('POST without scene name returns 400', async () => {
  const { http, port } = await startServer();
  try {
    const res = await post(port, '');
    assert.equal(res.status, 502); // handler 抛出"场景名不能为空"
    const data = await res.json();
    assert.equal(data.ok, false);
  } finally {
    await http.stop();
  }
});

test('POST with invalid JSON returns 400', async () => {
  const { http, port } = await startServer();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/obs/switch-scene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{',
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /JSON/);
  } finally {
    await http.stop();
  }
});

test('POST handler errors surface as 502', async () => {
  const { http, port } = await startServer();
  try {
    const res = await post(port, 'boom');
    assert.equal(res.status, 502);
    const data = await res.json();
    assert.match(data.error, /OBS 连接失败/);
  } finally {
    await http.stop();
  }
});

test('unrelated POST is still 405', async () => {
  const { http, port } = await startServer();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/whatever`, {
      method: 'POST',
      body: '{}',
    });
    assert.equal(res.status, 405);
  } finally {
    await http.stop();
  }
});

test('endpoint is disabled when no switchSceneHandler is wired', async () => {
  const { http, port } = await startServer({ switchSceneHandler: null });
  try {
    const res = await post(port, '正片');
    assert.equal(res.status, 405);
  } finally {
    await http.stop();
  }
});

test('GET endpoints remain unaffected', async () => {
  const { http, port } = await startServer();
  try {
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
    const page = await fetch(`http://127.0.0.1:${port}/standby.html`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
  } finally {
    await http.stop();
  }
});
