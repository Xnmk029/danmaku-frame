import zlib from 'zlib';

export function makePacket(opcode, payload = '', protover = 3) {
  const body = Buffer.from(payload, 'utf8');
  const header = Buffer.alloc(16);
  header.writeUInt32BE(16 + body.length, 0);
  header.writeUInt16BE(16, 4);
  header.writeUInt16BE(protover, 6);
  header.writeUInt32BE(opcode, 8);
  header.writeUInt32BE(1, 12);
  return Buffer.concat([header, body]);
}

export function decodePackets(buffer, output = []) {
  let offset = 0;

  while (offset + 16 <= buffer.length) {
    const packetLength = buffer.readUInt32BE(offset);
    const headerLength = buffer.readUInt16BE(offset + 4);
    const protover = buffer.readUInt16BE(offset + 6);
    const opcode = buffer.readUInt32BE(offset + 8);

    if (packetLength < 16 || headerLength < 16 || headerLength > packetLength) break;
    if (offset + packetLength > buffer.length) break;

    const body = buffer.subarray(offset + headerLength, offset + packetLength);
    if (opcode === 5 && (protover === 2 || protover === 3)) {
      try {
        const decompressed = protover === 3
          ? zlib.brotliDecompressSync(body)
          : zlib.inflateSync(body);
        decodePackets(decompressed, output);
      } catch (error) {
        output.push({ opcode, protover, error: `decompress_failed: ${error.message}` });
      }
    } else {
      output.push({ opcode, protover, body });
    }

    offset += packetLength;
  }

  return output;
}
