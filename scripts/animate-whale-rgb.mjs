// 大鲸鱼 RGB 动态滤镜 —— 通过 OBS WebSocket 驱动"大鲸鱼"来源的色彩校正滤镜 hue_shift 循环扫描，
// 产生 RGB 流光 / 色相流动效果（红→黄→绿→青→蓝→紫→红）。
// 用法：node scratch/animate-whale-rgb.mjs [速度°/s]（默认 60°/s = 6 秒一圈）
// 服务定义：LiveControl → 鲸鱼RGB（health: process）
import OBSWebSocket from 'obs-websocket-js';
import dotenv from 'dotenv';

dotenv.config();

const obs = new OBSWebSocket();
const obsUrl = process.env.OBS_WEBSOCKET_URL || 'ws://127.0.0.1:4455';
const obsPassword = process.env.OBS_WEBSOCKET_PASSWORD || undefined;
const DEG_PER_SEC = Number(process.argv[2] || process.env.WHALE_RGB_DEG_PER_SEC || 60);
const FRAME_MS = 50; // 20 FPS

async function findWhale() {
  const sceneRes = await obs.call('GetCurrentProgramScene');
  const sceneName = sceneRes.currentProgramSceneName;
  const itemList = await obs.call('GetSceneItemList', { sceneName });
  const whale = itemList.sceneItems.find(item => item.sourceName.includes('鲸'));
  if (!whale) throw new Error(`当前场景 "${sceneName}" 中未找到包含"鲸"的来源`);
  return { sceneName, sourceName: whale.sourceName };
}

async function ensureColorFilter(sourceName) {
  const filters = await obs.call('GetSourceFilterList', { sourceName });
  const color = filters.filters.find(f => f.filterKind === 'color_filter_v2');
  if (color) return color.filterName;
  // 没有色彩校正滤镜则创建（hue_shift 默认 0）
  await obs.call('CreateSourceFilter', {
    sourceName,
    filterName: 'RGB流光',
    filterKind: 'color_filter_v2',
    filterSettings: { hue_shift: 0 },
  });
  console.log(`[WhaleRGB] 已创建色彩校正滤镜「RGB流光」`);
  return 'RGB流光';
}

async function main() {
  await obs.connect(obsUrl, obsPassword);
  console.log(`[WhaleRGB] Connected to OBS (hue 扫描 ${DEG_PER_SEC}°/s)`);

  const { sourceName } = await findWhale();
  const filterName = await ensureColorFilter(sourceName);

  // 记录初始 hue_shift，退出时恢复
  const initial = await obs.call('GetSourceFilter', { sourceName, filterName });
  const initialHue = Number(initial.filterSettings.hue_shift ?? 0);
  console.log(`[WhaleRGB] 源=${sourceName} 滤镜=${filterName} 初始 hue=${initialHue}`);

  let hue = (initialHue + 180 + 360) % 360; // 从当前色相继续
  let lastTime = Date.now();

  const timer = setInterval(async () => {
    const now = Date.now();
    const deltaSec = (now - lastTime) / 1000;
    lastTime = now;
    hue = (hue + DEG_PER_SEC * deltaSec) % 360;
    // OBS hue_shift 范围 -180~180
    const shift = hue > 180 ? hue - 360 : hue;
    try {
      await obs.call('SetSourceFilterSettings', {
        sourceName,
        filterName,
        filterSettings: { hue_shift: Math.round(shift * 10) / 10 },
        overlay: true,
      });
    } catch (err) {
      // 忽略瞬时帧错误
    }
  }, FRAME_MS);

  const cleanup = async () => {
    clearInterval(timer);
    console.log(`[WhaleRGB] 恢复 initial hue=${initialHue} 并断开...`);
    try {
      await obs.call('SetSourceFilterSettings', {
        sourceName,
        filterName,
        filterSettings: { hue_shift: initialHue },
        overlay: true,
      });
    } catch (e) { /* ignore */ }
    try { await obs.disconnect(); } catch (e) { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch(error => {
  console.error('[WhaleRGB] 运行失败:', error.message);
  process.exit(1);
});