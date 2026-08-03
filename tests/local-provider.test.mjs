import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalMusicProvider } from '../src/music/providers/local-provider.mjs';
import { DirectUrlProvider } from '../src/music/providers/direct-url-provider.mjs';

test('local provider resolves a matching audio file inside project root', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'danmaku-provider-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const music = path.join(root, 'music');
  fs.mkdirSync(music);
  fs.writeFileSync(path.join(music, '歌手 - 测试歌曲.mp3'), '');

  const provider = new LocalMusicProvider({ projectRoot: root, musicDirectory: music });
  const result = await provider.resolve('测试歌曲');
  assert.equal(result.title, '测试歌曲');
  assert.equal(result.artist, '歌手');
  assert.match(result.sourceUrl, /^\/music\//);
});

test('direct URL provider is opt-in and accepts only audio-looking URLs', async () => {
  const disabled = new DirectUrlProvider({ enabled: false });
  assert.equal(await disabled.resolve('https://example.com/test.mp3'), null);

  const enabled = new DirectUrlProvider({ enabled: true });
  assert.equal(
    (await enabled.resolve('https://example.com/test.mp3')).provider,
    'direct-url',
  );
  await assert.rejects(
    enabled.resolve('https://example.com/page'),
    /必须指向受支持的音频文件/,
  );
});
