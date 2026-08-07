import test from 'node:test';
import assert from 'node:assert/strict';
import { parseV1Body, v1ToStateUpdate, sniffImageMime } from '../src/ncm/amll-v1.mjs';

function ns(str) {
  return Buffer.concat([Buffer.from(str, 'utf8'), Buffer.from([0])]);
}

test('parses SetMusicInfo (magic 2)', () => {
  const parts = [Buffer.from([2, 0])];
  parts.push(ns('28967124'));           // musicId
  parts.push(ns('告白气球'));           // musicName
  parts.push(ns(''));                   // albumId
  parts.push(ns('周杰伦的床边故事'));   // albumName
  const artistCount = Buffer.alloc(4); artistCount.writeUInt32LE(1, 0);
  parts.push(artistCount);
  parts.push(ns('6452'), ns('周杰伦')); // artist
  const duration = Buffer.alloc(8); duration.writeBigUInt64LE(217000n, 0);
  parts.push(duration);

  const msg = parseV1Body(Buffer.concat(parts));
  assert.equal(msg.type, 'setMusicInfo');
  assert.equal(msg.value.musicName, '告白气球');
  assert.equal(msg.value.musicId, '28967124');
  assert.deepEqual(msg.value.artists, [{ id: '6452', name: '周杰伦' }]);
  assert.equal(msg.value.duration, 217000);

  const update = v1ToStateUpdate(msg);
  assert.equal(update.update, 'setMusic');
  assert.equal(update.musicName, '告白气球');
});

test('parses SetMusicAlbumCoverImageURI (magic 3)', () => {
  const buf = Buffer.concat([Buffer.from([3, 0]), ns('https://p3.music.126.net/cover.png')]);
  const msg = parseV1Body(buf);
  assert.equal(msg.type, 'setMusicAlbumCoverImageURI');
  assert.equal(v1ToStateUpdate(msg).url, 'https://p3.music.126.net/cover.png');
});

test('parses SetMusicAlbumCoverImageData (magic 4) and sniffs mime', () => {
  const pngHead = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const size = Buffer.alloc(4); size.writeUInt32LE(pngHead.length, 0);
  const buf = Buffer.concat([Buffer.from([4, 0]), size, pngHead]);
  const msg = parseV1Body(buf);
  assert.equal(msg.type, 'setMusicAlbumCoverImageData');
  const update = v1ToStateUpdate(msg);
  assert.equal(update.update, 'setCover');
  assert.equal(update.source, 'data');
  assert.equal(update.image.mimeType, 'image/png');
  assert.equal(update.image.data, pngHead.toString('base64'));
  assert.equal(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
});

test('parses OnPlayProgress / OnPaused / OnResumed', () => {
  const prog = Buffer.alloc(10);
  prog.writeUInt16LE(5, 0);
  prog.writeBigUInt64LE(12345n, 2);
  const p = parseV1Body(prog);
  assert.equal(p.type, 'onPlayProgress');
  assert.equal(v1ToStateUpdate(p).progress, 12345);

  assert.equal(parseV1Body(Buffer.from([7, 0])).type, 'onPaused');
  assert.equal(parseV1Body(Buffer.from([8, 0])).type, 'onResumed');
  assert.equal(v1ToStateUpdate(parseV1Body(Buffer.from([7, 0]))).update, 'paused');
  assert.equal(v1ToStateUpdate(parseV1Body(Buffer.from([8, 0]))).update, 'resumed');
});

test('ping/pong and unknown magic are handled', () => {
  assert.equal(parseV1Body(Buffer.from([0, 0])).type, 'ping');
  assert.equal(parseV1Body(Buffer.from([1, 0])).type, 'pong');
  assert.equal(parseV1Body(Buffer.from([9, 0, 0, 0])).type, 'unknown');
  assert.equal(v1ToStateUpdate(parseV1Body(Buffer.from([9, 0, 0, 0]))), null);
  assert.equal(parseV1Body(Buffer.alloc(1)).type, 'unknown');
  assert.equal(parseV1Body(null).type, 'unknown');
});

test('round-trips a realistic connector stream', () => {
  // setMusicInfo + progress 交替（模拟旧版 connector）
  const info = Buffer.concat([
    Buffer.from([2, 0]),
    ns('3384554871'), ns('雨下一整晚'), ns(''), ns('跨时代'),
    (() => { const b = Buffer.alloc(4); b.writeUInt32LE(2, 0); return b; })(),
    ns('6452'), ns('周杰伦'), ns('6452'), ns('周杰伦'),
    (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(269000n, 0); return b; })(),
  ]);
  const msg = parseV1Body(info);
  assert.equal(msg.type, 'setMusicInfo');
  assert.equal(msg.value.musicName, '雨下一整晚');
  assert.equal(msg.value.artists.length, 2);
  assert.equal(msg.value.duration, 269000);
});
