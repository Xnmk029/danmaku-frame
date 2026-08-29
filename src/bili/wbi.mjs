import { createHash } from 'crypto';

/**
 * B站 WBI 签名（bilive-danmaku 方案）：
 * getDanmuInfo 等接口需 wbi 签名 + buvid3 才能绕过 -352 风控。
 * SESSDATA 有效时从 nav 接口取 img_key/sub_key；失效时返回 null（调用方降级）。
 */
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
];

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function getMixinKey(orig) {
  return MIXIN_KEY_ENC_TAB.map(n => orig[n]).join('').slice(0, 32);
}

/** 为请求参数做 wbi 签名，返回带 w_rid 的 query 字符串。 */
function encWbi(params, imgKey, subKey) {
  const mixinKey = getMixinKey(imgKey + subKey);
  const currTime = Math.round(Date.now() / 1000);
  const chrFilter = /[!'()*]/g;
  const p = { ...params, wts: currTime };
  const query = Object.keys(p).sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(String(p[key]).replace(chrFilter, ''))}`)
    .join('&');
  const wrid = createHash('md5').update(query + mixinKey).digest('hex');
  return `${query}&w_rid=${wrid}`;
}

/** 获取 buvid3（匿名可用，风控标识）。 */
export async function getBuvid3(cookie = '') {
  try {
    const response = await fetch('https://api.bilibili.com/x/frontend/finger/spi', {
      headers: { 'User-Agent': 'Mozilla/5.0', Cookie: cookie },
      signal: AbortSignal.timeout(8000),
    });
    const payload = await response.json();
    return payload?.data?.b_3 || '';
  } catch {
    return '';
  }
}

/** 从 nav 接口取 wbi keys；SESSDATA 失效返回 null。 */
export async function getWbiKeys(cookie = '') {
  try {
    const response = await fetch('https://api.bilibili.com/x/web-interface/nav', {
      headers: { 'User-Agent': USER_AGENT, Cookie: cookie, Referer: 'https://www.bilibili.com/' },
      signal: AbortSignal.timeout(8000),
    });
    const payload = await response.json();
    if (payload?.code !== 0 || !payload?.data?.wbi_img) return null;
    const { img_url: imgUrl, sub_url: subUrl } = payload.data.wbi_img;
    const imgKey = imgUrl.slice(imgUrl.lastIndexOf('/') + 1, imgUrl.lastIndexOf('.'));
    const subKey = subUrl.slice(subUrl.lastIndexOf('/') + 1, subUrl.lastIndexOf('.'));
    return { imgKey, subKey };
  } catch {
    return null;
  }
}

/** 为 getDanmuInfo 生成带 wbi 签名的完整 URL；SESSDATA 无效时返回 null（降级匿名请求）。 */
export async function buildDanmuInfoUrl(roomId, cookie = '', buvid3 = '') {
  const keys = await getWbiKeys(cookie);
  if (!keys) return null;
  const params = { id: roomId, type: 0, web_location: 444.8 };
  const signed = encWbi(params, keys.imgKey, keys.subKey);
  return `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?${signed}`;
}

export { encWbi, getMixinKey };