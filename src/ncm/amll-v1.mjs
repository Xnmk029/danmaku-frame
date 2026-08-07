/**
 * AMLL WebSocket 协议 V1（纯二进制，小端）解析器
 * 规范：amll-dev/ws-protocol PROTOCOL.md
 *
 * NullString = \0 结尾 UTF-8；Vec<T> = u32 数量 + 元素；u64/f64 小端。
 */
export const V1_MAGIC = {
  Ping: 0, Pong: 1, SetMusicInfo: 2, SetMusicAlbumCoverImageURI: 3,
  SetMusicAlbumCoverImageData: 4, OnPlayProgress: 5, OnVolumeChanged: 6,
  OnPaused: 7, OnResumed: 8, OnAudioData: 9, SetLyric: 10, SetLyricFromTTML: 11,
};

function readNullString(buf, off) {
  const end = buf.indexOf(0, off);
  if (end < 0) return { value: buf.toString('utf8', off), off: buf.length };
  return { value: buf.toString('utf8', off, end), off: end + 1 };
}

function readVecU8(buf, off) {
  const count = buf.readUInt32LE(off);
  return { value: buf.subarray(off + 4, off + 4 + count), off: off + 4 + count };
}

function readArtists(buf, off) {
  const count = buf.readUInt32LE(off);
  off += 4;
  const artists = [];
  for (let i = 0; i < count && off < buf.length; i++) {
    const id = readNullString(buf, off); off = id.off;
    const name = readNullString(buf, off); off = name.off;
    artists.push({ id: id.value, name: name.value });
  }
  return { value: artists, off };
}

/** 解析一条 V1 二进制消息；无法识别时返回 { type: 'unknown' } */
export function parseV1Body(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 2) return { type: 'unknown' };
  const magic = buf.readUInt16LE(0);
  let off = 2;
  try {
    switch (magic) {
      case V1_MAGIC.SetMusicInfo: {
        const musicId = readNullString(buf, off); off = musicId.off;
        const musicName = readNullString(buf, off); off = musicName.off;
        const albumId = readNullString(buf, off); off = albumId.off;
        const albumName = readNullString(buf, off); off = albumName.off;
        const artists = readArtists(buf, off); off = artists.off;
        const duration = Number(buf.readBigUInt64LE(off));
        return {
          type: 'setMusicInfo',
          value: {
            musicId: musicId.value, musicName: musicName.value,
            albumId: albumId.value, albumName: albumName.value,
            artists: artists.value, duration,
          },
        };
      }
      case V1_MAGIC.SetMusicAlbumCoverImageURI: {
        const url = readNullString(buf, off);
        return { type: 'setMusicAlbumCoverImageURI', value: { imgUrl: url.value } };
      }
      case V1_MAGIC.SetMusicAlbumCoverImageData: {
        const data = readVecU8(buf, off);
        return { type: 'setMusicAlbumCoverImageData', value: { data: data.value } };
      }
      case V1_MAGIC.OnPlayProgress:
        return { type: 'onPlayProgress', value: { progress: Number(buf.readBigUInt64LE(off)) } };
      case V1_MAGIC.OnVolumeChanged:
        return { type: 'onVolumeChanged', value: { volume: buf.readDoubleLE(off) } };
      case V1_MAGIC.OnPaused:
        return { type: 'onPaused' };
      case V1_MAGIC.OnResumed:
        return { type: 'onResumed' };
      case V1_MAGIC.Ping:
        return { type: 'ping' };
      case V1_MAGIC.Pong:
        return { type: 'pong' };
      default:
        return { type: 'unknown', magic };
    }
  } catch {
    return { type: 'unknown', magic };
  }
}

/** 从图片二进制嗅探 MIME（网易云封面多为 jpg/png） */
export function sniffImageMime(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf.length >= 4 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return 'image/webp';
  return 'image/jpeg';
}

/** 将 V1 消息映射为聚合器的 state 更新；非元数据消息返回 null */
export function v1ToStateUpdate(message) {
  switch (message.type) {
    case 'setMusicInfo':
      return {
        update: 'setMusic',
        musicId: message.value.musicId,
        musicName: message.value.musicName,
        albumId: message.value.albumId,
        albumName: message.value.albumName,
        artists: message.value.artists,
        duration: message.value.duration,
      };
    case 'setMusicAlbumCoverImageURI':
      return { update: 'setCover', source: 'uri', url: message.value.imgUrl };
    case 'setMusicAlbumCoverImageData':
      return {
        update: 'setCover',
        source: 'data',
        image: {
          mimeType: sniffImageMime(message.value.data),
          data: message.value.data.toString('base64'),
        },
      };
    case 'onPlayProgress':
      return { update: 'progress', progress: message.value.progress };
    case 'onPaused':
      return { update: 'paused' };
    case 'onResumed':
      return { update: 'resumed' };
    default:
      return null;
  }
}
