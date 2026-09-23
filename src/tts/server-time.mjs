import https from 'node:https';

/**
 * 服务器时间校准：Sec-MS-GEC 令牌由「当前时间」哈希而来，微软服务端只容忍几分钟偏差。
 * 本机时钟不准（常见于虚拟机/长期未同步的 Windows）会导致握手直接 403。
 * 这里通过 HTTPS 响应的 Date 头估算「本机 ⇄ 服务器」时钟偏差并缓存，
 * 令牌生成时一律使用校准后的时间，本机时钟对错都不影响合成。
 */

const TIME_SOURCES = ['speech.platform.bing.com', 'www.bing.com', 'www.microsoft.com'];

/** 偏差缓存有效期：偏差漂移缓慢，10 分钟刷新一次足够（后台异步刷新，不阻塞合成）。 */
const OFFSET_TTL_MS = 10 * 60 * 1000;
/** 小于该偏差视为本机时钟正常，无需校准。 */
const SIGNIFICANT_SKEW_MS = 60 * 1000;
/** 单源探测超时。 */
const FETCH_TIMEOUT_MS = 4000;

let cachedOffsetMs = 0;
let fetchedAt = 0;
let inflight = null;
let skewWarned = false;

function probeHost(hostname) {
  return new Promise(resolve => {
    const startedAt = Date.now();
    const req = https.request(
      { hostname, path: '/', method: 'HEAD', timeout: FETCH_TIMEOUT_MS },
      res => {
        const rtt = Date.now() - startedAt;
        // Date 头只有秒精度，用请求中点近似，误差受 RTT 一半影响（秒级容忍度下可忽略）
        const serverMs = res.headers.date ? new Date(`${res.headers.date} GMT`).getTime() : null;
        resolve(serverMs != null && Number.isFinite(serverMs) ? serverMs + rtt / 2 - startedAt : null);
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

async function fetchOffset() {
  for (const hostname of TIME_SOURCES) {
    const offset = await probeHost(hostname);
    if (offset != null) return Math.round(offset);
  }
  return null;
}

/**
 * 估算当前真实时间（毫秒）。
 * 首次调用会同步探测一次（约百毫秒级）；探测全部失败时退回本机时钟。
 * @returns {Promise<number>} 校准后的 Date.now() 等价值
 */
export async function getServerNow() {
  const fresh = Date.now() - fetchedAt < OFFSET_TTL_MS;
  if (!fresh && !inflight) {
    inflight = fetchOffset()
      .then(offset => {
        if (offset != null) {
          cachedOffsetMs = offset;
          fetchedAt = Date.now();
          if (!skewWarned && Math.abs(offset) > SIGNIFICANT_SKEW_MS) {
            skewWarned = true;
            const slow = offset > 0 ? '慢' : '快';
            console.warn(`[ServerTime] 本机时钟比服务器${slow} ${Math.abs(offset / 60000).toFixed(1)} 分钟，已按服务器时间生成 TTS 令牌；建议校准系统时间（设置→时间和语言→立即同步）。`);
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        inflight = null;
      });
    // 首次（缓存尚无有效值）必须等结果，否则令牌仍会用错的时间；之后过期刷新走后台
    if (fetchedAt === 0) await inflight;
  }
  return Date.now() + cachedOffsetMs;
}
