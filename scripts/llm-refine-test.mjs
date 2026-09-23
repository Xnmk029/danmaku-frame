// 细化质量冒烟测试：node scripts/llm-refine-test.mjs [描述...]
import { loadConfig } from '../src/config/env.mjs';
import { SenseNovaClient } from '../src/llm/sensenova.mjs';
import { refineVoicePrompt } from '../src/llm/voice-prompts.mjs';

const config = loadConfig(process.cwd());
const llm = new SenseNovaClient(config.llm);
if (!llm.available) { console.error('未配置 SENSENOVA_API_KEY'); process.exit(1); }

const raws = process.argv.slice(2);
const cases = raws.length ? raws : ['派大星', '萝莉音', '高冷御姐带点电台腔', '今天天气真好'];

for (const raw of cases) {
  const t = Date.now();
  try {
    const refined = await refineVoicePrompt(llm, raw);
    console.log(`[${raw}] ${Date.now() - t}ms (${refined.length}字): ${refined}`);
  } catch (error) {
    console.log(`[${raw}] ${Date.now() - t}ms 失败: ${error.message}`);
  }
}
