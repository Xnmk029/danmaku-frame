import test from 'node:test';
import assert from 'node:assert/strict';
import { SongRequestService } from '../src/song-request/song-service.mjs';
import { MemorySongRepository } from '../src/song-request/repository.mjs';

function createService(overrides = {}) {
  let clock = 1_000;
  const providers = {
    async resolve(query) {
      return {
        provider: 'test',
        title: query,
        artist: 'Tester',
        sourceUrl: `/music/${encodeURIComponent(query)}.mp3`,
        durationSeconds: 180,
      };
    },
  };
  const service = new SongRequestService({
    config: {
      enabled: true,
      ownerUid: '1',
      adminUids: new Set(['2']),
      maxQueueLength: 5,
      maxPerUser: 2,
      cooldownMs: 0,
      maxDurationSeconds: 600,
      blockedUids: new Set(),
      allowedUids: new Set(),
      blockedKeywords: [],
      ...overrides,
    },
    repository: new MemorySongRepository(),
    providers,
    now: () => clock++,
  });
  return service;
}

test('starts the first request and queues following requests', async () => {
  const service = createService();
  const first = await service.submitRequest({ uid: '10', user: '甲' }, '第一首');
  const second = await service.submitRequest({ uid: '11', user: '乙' }, '第二首');

  assert.equal(first.position, 0);
  assert.equal(service.state.current.track.title, '第一首');
  assert.equal(second.position, 1);
  assert.equal(service.state.queue[0].track.title, '第二首');
});

test('prevents duplicate tracks and enforces per-user quota', async () => {
  const service = createService({ maxPerUser: 1 });
  await service.submitRequest({ uid: '10', user: '甲' }, '第一首');

  await assert.rejects(
    service.submitRequest({ uid: '11', user: '乙' }, '第一首'),
    /已在播放或队列中/,
  );
  await assert.rejects(
    service.submitRequest({ uid: '10', user: '甲' }, '第二首'),
    /最多同时排队 1 首/,
  );
});

test('moderator command skips while normal viewer is rejected', async () => {
  const service = createService();
  await service.submitRequest({ uid: '10', user: '甲' }, '第一首');
  await service.submitRequest({ uid: '11', user: '乙' }, '第二首');

  await service.handleDanmaku({ uid: '10', user: '甲', text: '下一首' });
  assert.equal(service.state.current.track.title, '第一首');

  await service.handleDanmaku({ uid: '1', user: '主播', text: '下一首' });
  assert.equal(service.state.current.track.title, '第二首');
});

test('player completion advances and records history', async () => {
  const service = createService();
  await service.submitRequest({ uid: '10', user: '甲' }, '第一首');
  await service.submitRequest({ uid: '11', user: '乙' }, '第二首');
  service.handlePlayerEvent('ended');

  assert.equal(service.state.current.track.title, '第二首');
  assert.equal(service.state.history[0].track.title, '第一首');
  assert.equal(service.state.history[0].status, 'completed');
});

test('applies UID allow/block lists and keyword filtering', async () => {
  const service = createService({
    blockedUids: new Set(['9']),
    allowedUids: new Set(['10']),
    blockedKeywords: ['违禁'],
  });

  await assert.rejects(
    service.submitRequest({ uid: '9', user: '黑名单' }, '普通歌曲'),
    /没有点歌权限/,
  );
  await assert.rejects(
    service.submitRequest({ uid: '11', user: '非白名单' }, '普通歌曲'),
    /仅允许白名单/,
  );
  await assert.rejects(
    service.submitRequest({ uid: '10', user: '白名单' }, '违禁歌曲'),
    /关键词不符合/,
  );
});
