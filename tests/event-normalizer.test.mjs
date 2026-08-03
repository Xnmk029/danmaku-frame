import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBiliCommand } from '../src/bili/event-normalizer.mjs';

test('normalizes danmaku identity and medal data', () => {
  const event = normalizeBiliCommand({
    cmd: 'DANMU_MSG',
    info: [[], '点歌 测试歌曲', [12345, '测试用户', 1], [8, '测试牌'], 0, 0, 0, 3],
  });

  assert.equal(event.type, 'danmaku');
  assert.equal(event.uid, '12345');
  assert.equal(event.user, '测试用户');
  assert.equal(event.text, '点歌 测试歌曲');
  assert.equal(event.admin, true);
  assert.deepEqual(event.medal, { name: '测试牌', lv: 8 });
});

test('returns null for unsupported events', () => {
  assert.equal(normalizeBiliCommand({ cmd: 'WELCOME' }), null);
  assert.equal(normalizeBiliCommand(null), null);
});
