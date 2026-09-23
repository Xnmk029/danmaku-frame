import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { InteractionService } from '../src/interaction/interaction-service.mjs';

function makeClient() {
  const client = new EventEmitter();
  client.connected = true;
  client.roomId = '30068664';
  client.authMode = 'login';
  return client;
}

test('buffers feed events and keeps capacity bound', () => {
  const client = makeClient();
  const svc = new InteractionService({ biliClient: client, capacity: 5 });
  for (let i = 0; i < 8; i++) {
    client.emit('event', { type: 'danmaku', uid: '1', user: 'u', text: `m${i}`, receivedAt: i });
  }
  assert.equal(svc.recent.length, 5);
  assert.equal(svc.recent[0].text, 'm3');
  assert.equal(svc.recent.at(-1).text, 'm7');
});

test('marks owner danmaku with isOwner flag', () => {
  const client = makeClient();
  const svc = new InteractionService({ biliClient: client, ownerUid: '777' });
  client.emit('event', { type: 'danmaku', uid: '777', user: '主播', text: 'hi' });
  client.emit('event', { type: 'danmaku', uid: '1', user: '观众', text: 'hi' });
  assert.equal(svc.recent[0].isOwner, true);
  assert.equal(svc.recent[1].isOwner, undefined);
});

test('aggregates stats from popularity/watched/like events', () => {
  const client = makeClient();
  const svc = new InteractionService({ biliClient: client });
  client.emit('event', { type: 'popularity', value: 99 });
  client.emit('event', { type: 'watched', count: 500, text: '500人看过' });
  client.emit('event', { type: 'like', count: 233 });
  assert.deepEqual(svc.stats, { popularity: 99, watched: 500, watchedText: '500人看过', likes: 233 });
  // 统计事件不进 feed 缓冲
  assert.equal(svc.recent.length, 0);
});

test('snapshot includes connection, auth gate and feed', () => {
  const client = makeClient();
  const svc = new InteractionService({
    biliClient: client,
    ownerUid: '777',
    authProvider: () => ({ status: 'valid', message: '登录有效', name: '主播号' }),
  });
  client.emit('event', { type: 'entry', uid: '5', user: '访客', text: '进入直播间' });
  const snap = svc.snapshot();
  assert.equal(snap.connected, true);
  assert.equal(snap.roomId, '30068664');
  assert.equal(snap.canSend, true);
  assert.equal(snap.auth.status, 'valid');
  assert.equal(snap.recent.length, 1);
  assert.equal(snap.recent[0].type, 'entry');
});

test('canSend is false when login invalid', () => {
  const client = makeClient();
  const svc = new InteractionService({
    biliClient: client,
    authProvider: () => ({ status: 'expired' }),
  });
  assert.equal(svc.snapshot().canSend, false);
});
