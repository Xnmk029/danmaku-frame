import test from 'node:test';
import assert from 'node:assert/strict';
import { ObsProxy } from '../src/obs/obs-proxy.mjs';

function fakeClient() {
  const calls = [];
  return {
    calls,
    connect: async () => {},
    disconnect: async () => {},
    call: async (name, args) => {
      calls.push([name, args]);
      return {};
    },
  };
}

test('switchScene requires a non-empty scene name', async () => {
  const proxy = new ObsProxy({ url: 'ws://127.0.0.1:4455', connectImpl: () => fakeClient() });
  await assert.rejects(() => proxy.switchScene('   '), /场景名/);
  await assert.rejects(() => proxy.switchScene(''), /场景名/);
});

test('switchScene fails with a friendly error when OBS URL is not configured', async () => {
  const proxy = new ObsProxy({ url: '', password: '' });
  await assert.rejects(() => proxy.switchScene('正片'), /OBS_WEBSOCKET_URL/);
  assert.equal(proxy.configured, false);
});

test('switchScene connects lazily and calls SetCurrentProgramScene', async () => {
  const client = fakeClient();
  let constructed = 0;
  const proxy = new ObsProxy({
    url: 'ws://127.0.0.1:4455',
    connectImpl: () => { constructed += 1; return client; },
  });

  // 未触发任何操作前不应构造客户端
  assert.equal(constructed, 0);

  const result = await proxy.switchScene('正片');
  assert.equal(result.ok, true);
  assert.equal(result.scene, '正片');
  assert.deepEqual(client.calls, [['SetCurrentProgramScene', { sceneName: '正片' }]]);
  assert.equal(constructed, 1);
});

test('switchScene is idempotent within the same scene window', async () => {
  let now = 1000;
  const client = fakeClient();
  const proxy = new ObsProxy({
    url: 'ws://127.0.0.1:4455',
    connectImpl: () => client,
    now: () => now,
  });

  await proxy.switchScene('正片');
  assert.equal(client.calls.length, 1);

  // 同一场景 5 秒内：跳过，不重复调用
  now += 1000;
  const skipped = await proxy.switchScene('正片');
  assert.equal(skipped.skipped, true);
  assert.equal(client.calls.length, 1);

  // 超过 5 秒：允许再次切换
  now += 6_000;
  await proxy.switchScene('正片');
  assert.equal(client.calls.length, 2);

  // 不同场景：立即切换
  await proxy.switchScene('休息');
  assert.equal(client.calls.length, 3);
  assert.deepEqual(client.calls[2], ['SetCurrentProgramScene', { sceneName: '休息' }]);
});

test('switchScene surfaces connection failures as readable errors', async () => {
  const proxy = new ObsProxy({
    url: 'ws://127.0.0.1:4455',
    connectImpl: () => ({
      connect: async () => { throw new Error('Connection refused'); },
      call: async () => {},
    }),
  });
  await assert.rejects(() => proxy.switchScene('正片'), /Connection refused/);
  // 失败后 client 被清空，下次可重试
  assert.equal(proxy.client, null);
});

test('disconnect releases the client without throwing', async () => {
  let disconnected = 0;
  const proxy = new ObsProxy({
    url: 'ws://127.0.0.1:4455',
    connectImpl: () => ({
      connect: async () => {},
      disconnect: async () => { disconnected += 1; },
      call: async () => {},
    }),
  });
  await proxy.switchScene('正片');
  await proxy.disconnect();
  assert.equal(disconnected, 1);
  assert.equal(proxy.client, null);
  await proxy.disconnect(); // 二次断开安全
});
