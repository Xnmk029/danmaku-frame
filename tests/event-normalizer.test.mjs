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

test('parses inline emots from msgExtra (string form)', () => {
  const event = normalizeBiliCommand({
    cmd: 'DANMU_MSG',
    info: [
      [0, 1, 25, 16777215, 0, 0, 0, '', 0, 0, 0, '', 1, null, null, JSON.stringify({
        emots: {
          '[大笑]': { url: 'https://i0.hdslb.com/bfs/emote/a1.png', meta: { size: 'S' } },
          '[妙啊]': { url: 'https://i0.hdslb.com/bfs/emote/b2.png', meta: { size: 'L' } },
        },
      })],
      '哈哈[大笑]今天[妙啊]',
      [123, '表情用户'],
    ],
  });

  assert.deepEqual(event.emots, [
    { key: '[大笑]', url: 'https://i0.hdslb.com/bfs/emote/a1.png', size: 'S' },
    { key: '[妙啊]', url: 'https://i0.hdslb.com/bfs/emote/b2.png', size: 'L' },
  ]);
  assert.equal(event.bigEmote, null);
  assert.equal(event.text, '哈哈[大笑]今天[妙啊]');
});

test('parses inline emots from msgExtra (object form)', () => {
  const event = normalizeBiliCommand({
    cmd: 'DANMU_MSG',
    info: [[0, 0, 0, 0, 0, 0, 0, '', 0, 0, 0, '', 1, null, null, {
      emots: {
        '[2233娘_疑问]': { url: 'https://i0.hdslb.com/bfs/emote/c3.png', meta: { size: 'M' } },
      },
    }], '[2233娘_疑问]', [456, '内嵌用户']],
  });

  assert.deepEqual(event.emots, [
    { key: '[2233娘_疑问]', url: 'https://i0.hdslb.com/bfs/emote/c3.png', size: 'M' },
  ]);
  assert.equal(event.bigEmote, null);
});

test('parses a whole-line big emote from info[0][13]', () => {
  const event = normalizeBiliCommand({
    cmd: 'DANMU_MSG',
    info: [
      [0, 1, 25, 16777215, 0, 0, 0, '', 0, 0, 0, '', 1, {
        bulge_display: 0,
        emoticon_unique: 'official_120',
        height: 60,
        in_player_area: 1,
        url: 'https://i0.hdslb.com/bfs/live/d4.png',
        width: 105,
      }],
      '',
      [789, '大表情用户'],
    ],
  });

  assert.deepEqual(event.bigEmote, {
    unique: 'official_120',
    url: 'https://i0.hdslb.com/bfs/live/d4.png',
    width: 105,
    height: 60,
  });
  assert.deepEqual(event.emots, []);
  assert.equal(event.text, '');
});

test('plain danmaku has empty emots and no big emote', () => {
  const event = normalizeBiliCommand({
    cmd: 'DANMU_MSG',
    info: [[], '普通弹幕', [1, '用户']],
  });
  assert.deepEqual(event.emots, []);
  assert.equal(event.bigEmote, null);
});

test('malformed msgExtra degrades gracefully', () => {
  const event = normalizeBiliCommand({
    cmd: 'DANMU_MSG',
    info: [[0, 0, 0, 0, 0, 0, 0, '', 0, 0, 0, '', 1, null, null, '{broken json'], '文本[未注册表情]', [2, '用户']],
  });
  assert.deepEqual(event.emots, []);
  assert.equal(event.bigEmote, null);
  assert.equal(event.text, '文本[未注册表情]');
});
