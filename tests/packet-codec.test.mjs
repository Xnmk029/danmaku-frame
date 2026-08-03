import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { decodePackets, makePacket } from '../src/bili/packet-codec.mjs';

test('encodes and decodes an uncompressed packet', () => {
  const packet = makePacket(5, JSON.stringify({ cmd: 'TEST' }), 1);
  const decoded = decodePackets(packet);
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].opcode, 5);
  assert.deepEqual(JSON.parse(decoded[0].body.toString('utf8')), { cmd: 'TEST' });
});

test('recursively decodes brotli-compressed packets', () => {
  const inner = makePacket(5, JSON.stringify({ cmd: 'DANMU_MSG' }), 1);
  const compressed = zlib.brotliCompressSync(inner);
  const header = Buffer.alloc(16);
  header.writeUInt32BE(16 + compressed.length, 0);
  header.writeUInt16BE(16, 4);
  header.writeUInt16BE(3, 6);
  header.writeUInt32BE(5, 8);
  header.writeUInt32BE(1, 12);

  const decoded = decodePackets(Buffer.concat([header, compressed]));
  assert.equal(decoded.length, 1);
  assert.equal(JSON.parse(decoded[0].body.toString('utf8')).cmd, 'DANMU_MSG');
});

test('rejects invalid packet lengths without throwing', () => {
  const invalid = Buffer.alloc(16);
  invalid.writeUInt32BE(8, 0);
  assert.deepEqual(decodePackets(invalid), []);
});
