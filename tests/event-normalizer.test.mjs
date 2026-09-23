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

test('parses inline emots from msgExtra (new wrapped protocol, real sample)', () => {
  const event = normalizeBiliCommand({
    cmd: 'DANMU_MSG',
    info: [
      [0, 1, 25, 16777215, 0, 0, 0, '', 0, 0, 0, '', 1, '{}', null, JSON.stringify({
        extra: JSON.stringify({
          send_from_me: false,
          content: '真的[跪了]',
          emoticon_unique: '',
          bulge_display: 0,
          emots: {
            '[跪了]': {
              count: 1,
              emoji: '[跪了]',
              emoticon_id: 276,
              emoticon_unique: 'emoji_276',
              height: 20,
              url: 'http://i0.hdslb.com/bfs/live/4f2155b108047d60c1fa9dccdc4d7abba18379a0.png',
              width: 20,
            },
            '[妙啊]': {
              emoji: '[妙啊]',
              height: 62,
              url: 'http://i0.hdslb.com/bfs/live/big2.png',
              width: 110,
            },
          },
        }),
      })],
      '真的[跪了]',
      [123, '表情用户'],
    ],
  });

  assert.deepEqual(event.emots, [
    { key: '[跪了]', url: 'https://i0.hdslb.com/bfs/live/4f2155b108047d60c1fa9dccdc4d7abba18379a0.png', size: 'S', bulge: false },
    { key: '[妙啊]', url: 'https://i0.hdslb.com/bfs/live/big2.png', size: 'L', bulge: false },
  ]);
  assert.equal(event.bigEmote, null);
  assert.equal(event.text, '真的[跪了]');
});

test('parses inline emots from msgExtra (legacy direct object form)', () => {
  const event = normalizeBiliCommand({
    cmd: 'DANMU_MSG',
    info: [[0, 0, 0, 0, 0, 0, 0, '', 0, 0, 0, '', 1, null, null, {
      emots: {
        '[2233娘_疑问]': { emoji: '[2233娘_疑问]', url: 'http://i0.hdslb.com/bfs/emote/c3.png', width: 40, height: 40 },
      },
    }], '[2233娘_疑问]', [456, '内嵌用户']],
  });

  assert.deepEqual(event.emots, [
    { key: '[2233娘_疑问]', url: 'https://i0.hdslb.com/bfs/emote/c3.png', size: 'M', bulge: false },
  ]);
  assert.equal(event.bigEmote, null);
});

test('marks bulge emote when bulge_display is 1', () => {
  const event = normalizeBiliCommand({
    cmd: 'DANMU_MSG',
    info: [[0, 0, 0, 0, 0, 0, 0, '', 0, 0, 0, '', 1, '{}', null, {
      extra: JSON.stringify({
        content: '[贴纸]',
        bulge_display: 1,
        emots: {
          '[贴纸]': { emoji: '[贴纸]', url: 'http://i0.hdslb.com/bfs/live/sticker.png', width: 120, height: 60 },
        },
      }),
    }], '[贴纸]', [789, '贴纸用户']],
  });

  assert.equal(event.emots.length, 1);
  assert.equal(event.emots[0].bulge, true);
  assert.equal(event.emots[0].size, 'L');
  assert.equal(event.emots[0].url, 'https://i0.hdslb.com/bfs/live/sticker.png');
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

test('normalizes SEND_GIFT with medal info', () => {
  const event = normalizeBiliCommand({
    cmd: 'SEND_GIFT',
    data: {
      uid: 42, uname: '送礼用户', giftName: '小花花', num: 5, price: 200,
      medal_info: { medal_name: '鲸果', medal_level: 4, guard_level: 3 },
    },
  });
  assert.equal(event.type, 'gift');
  assert.equal(event.user, '送礼用户');
  assert.equal(event.giftName, '小花花');
  assert.equal(event.giftCount, 5);
  assert.deepEqual(event.medal, { name: '鲸果', lv: 4 });
  assert.equal(event.guard, 3);
});

test('normalizes SUPER_CHAT_MESSAGE with medal info', () => {
  const event = normalizeBiliCommand({
    cmd: 'SUPER_CHAT_MESSAGE',
    data: {
      uid: 7, price: 50, message: '醒目留言内容',
      user_info: { uname: 'SC用户' },
      medal_info: { medal_name: '鲸果', medal_level: 10 },
    },
  });
  assert.equal(event.type, 'sc');
  assert.equal(event.user, 'SC用户');
  assert.equal(event.price, 50);
  assert.equal(event.message, '醒目留言内容');
  assert.deepEqual(event.medal, { name: '鲸果', lv: 10 });
});

test('normalizes GUARD_BUY to guard event', () => {
  const event = normalizeBiliCommand({
    cmd: 'GUARD_BUY',
    data: { uid: 99, username: '新舰长', guard_level: 3, num: 1, price: 138000 },
  });
  assert.equal(event.type, 'guard');
  assert.equal(event.user, '新舰长');
  assert.equal(event.guardLevel, 3);
  assert.equal(event.guardName, '舰长');
  assert.equal(event.text, '开通了舰长');
  assert.equal(event.price, 138000);
});

test('normalizes INTERACT_WORD to entry event with medal', () => {
  const event = normalizeBiliCommand({
    cmd: 'INTERACT_WORD',
    data: {
      uid: 555, uname: '进场用户', msg_type: 1,
      fans_medal: { medal_name: '鲸果', medal_level: 4, guard_level: 3 },
    },
  });
  assert.equal(event.type, 'entry');
  assert.equal(event.user, '进场用户');
  assert.equal(event.text, '进入直播间');
  assert.deepEqual(event.medal, { name: '鲸果', lv: 4 });
  assert.equal(event.guard, 3);
});

test('INTERACT_WORD maps non-entry msg_type labels', () => {
  const event = normalizeBiliCommand({
    cmd: 'INTERACT_WORD',
    data: { uid: 1, uname: '观众', msg_type: 2 },
  });
  assert.equal(event.type, 'entry');
  assert.equal(event.text, '关注了主播');
});

test('normalizes WATCHED_CHANGE and LIKE_INFO_V3_UPDATE stats', () => {
  const watched = normalizeBiliCommand({
    cmd: 'WATCHED_CHANGE',
    data: { num: 1234, text_large: '1234人看过', text_small: '1234' },
  });
  assert.equal(watched.type, 'watched');
  assert.equal(watched.count, 1234);
  assert.equal(watched.text, '1234人看过');

  const like = normalizeBiliCommand({
    cmd: 'LIKE_INFO_V3_UPDATE',
    data: { like_count: 678 },
  });
  assert.equal(like.type, 'like');
  assert.equal(like.count, 678);
});
