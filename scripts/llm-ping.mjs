// SenseNova LLM 连通性自检：node scripts/llm-ping.mjs [提示词]
import { loadConfig } from '../src/config/env.mjs';

const config = loadConfig(process.cwd());
const apiKey = config.llm?.apiKey || process.env.SENSENOVA_API_KEY;
const baseUrl = (config.llm?.baseUrl || 'https://token.sensenova.cn/v1').replace(/\/+$/, '');
const model = config.llm?.model || 'sensenova-6.8-flash-lite';
const prompt = process.argv[2] || '用一句话介绍你自己';

if (!apiKey) {
  console.error('未配置 SENSENOVA_API_KEY');
  process.exit(1);
}

const t0 = Date.now();
const res = await fetch(`${baseUrl}/chat/completions`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model, max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
});
const payload = await res.json();
console.log(`HTTP ${res.status} · ${Date.now() - t0}ms`);
if (!res.ok) {
  console.error(JSON.stringify(payload));
  process.exit(2);
}
console.log(payload?.choices?.[0]?.message?.content || '(空)');
