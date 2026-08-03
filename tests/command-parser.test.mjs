import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSongCommand } from '../src/danmaku/command-parser.mjs';

test('parses Chinese song requests with flexible whitespace', () => {
  assert.deepEqual(parseSongCommand('  点歌： 周杰伦  晴天 '), {
    type: 'request',
    query: '周杰伦 晴天',
  });
  assert.deepEqual(parseSongCommand('来一首 夜曲'), {
    type: 'request',
    query: '夜曲',
  });
});

test('parses queue and moderator commands', () => {
  assert.deepEqual(parseSongCommand('取消点歌'), { type: 'cancel-own' });
  assert.deepEqual(parseSongCommand('歌单'), { type: 'list' });
  assert.deepEqual(parseSongCommand('下一首'), { type: 'skip' });
  assert.deepEqual(parseSongCommand('关闭点歌'), { type: 'disable' });
});

test('ignores unrelated danmaku and empty requests', () => {
  assert.equal(parseSongCommand('今天天气不错'), null);
  assert.equal(parseSongCommand('点歌'), null);
  assert.equal(parseSongCommand(''), null);
});
