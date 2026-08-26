import path from 'path';
import { fileURLToPath } from 'url';
import { EdgeTtsEngine } from '../src/tts/edge-tts.mjs';
import { WindowsPlayer } from '../src/tts/windows-player.mjs';

/**
 * 弹幕朗读自检脚本：Edge TTS 合成 → Windows 播放器朗读。
 * 用法：node scripts/speak-test.mjs "要朗读的文字" [音色]
 * 示例：node scripts/speak-test.mjs "欢迎来到直播间" zh-CN-YunxiNeural
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const text = process.argv[2] || '欢迎来到直播间，弹幕朗读测试。';
const voice = process.argv[3] || process.env.TTS_VOICE || 'zh-CN-XiaoxiaoNeural';

const engine = new EdgeTtsEngine({ voice, rate: process.env.TTS_RATE, pitch: process.env.TTS_PITCH, volume: process.env.TTS_VOLUME });
const player = new WindowsPlayer({
  audioDir: path.join(root, 'data', 'tts'),
  scriptFile: path.join(root, 'scripts', 'tts-player.ps1'),
  volume: Number(process.env.TTS_PLAYER_VOLUME || 100) / 100,
});

console.log(`[SpeakTest] 音色: ${voice}`);
console.log(`[SpeakTest] 文本: ${text}`);

try {
  await player.start();
  console.log('[SpeakTest] 播放器就绪');
  console.log('[SpeakTest] 正在调用 Edge TTS 在线合成...');
  const startedAt = Date.now();
  const audio = await engine.synthesize(text);
  console.log(`[SpeakTest] 合成完成: ${(audio.length / 1024).toFixed(1)} KB，耗时 ${Date.now() - startedAt}ms`);
  await player.play(audio);
  console.log('[SpeakTest] 播放完成 ✅ 请在扬声器确认声音（注意: 您自己听不到的话请检查系统音量）');
} catch (error) {
  console.error('[SpeakTest] 失败:', error.message);
  process.exitCode = 1;
} finally {
  await player.close();
  await engine.close();
}