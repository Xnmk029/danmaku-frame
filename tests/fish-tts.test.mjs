import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FishTtsEngine } from '../src/tts/fish-tts.mjs';
import { DanmakuTtsService } from '../src/tts/tts-service.mjs';
import { createHttpServer } from '../src/transport/http-server.mjs';
import { createWebSocketGateway } from '../src/transport/websocket-gateway.mjs';
import { EventEmitter, once } from 'node:events';
import { WebSocket } from 'ws';

const voice = '0123456789abcdef0123456789abcdef';
const mp3 = () => new Response(Buffer.from('ID3-fake-mp3'), { headers: { 'content-type': 'audio/mpeg' } });
test('Fish cloud request uses Bearer/model headers, reference_id and returns MP3 bytes', async () => {
  const engine = new FishTtsEngine({ apiKey: 'test-secret', referenceId: voice, fetchImpl: async (url, init) => {
    assert.equal(url, 'https://api.fish.audio/v1/tts');
    assert.equal(init.headers.Authorization, 'Bearer test-secret');
    assert.equal(init.headers.model, 's2.1-pro');
    const body = JSON.parse(init.body);
    assert.equal(body.reference_id, voice); assert.equal(body.text, '你好');
    assert.equal(body.format, 'mp3'); assert.equal(body.prosody.speed, 1.25);
    assert.equal('designPrompt' in body, false);
    return mp3();
  } });
  engine.setParameters({ rate: '+25%' });
  assert.equal((await engine.synthesize('你好')).toString(), 'ID3-fake-mp3');
});

test('Fish validates key/voice/model, rejects nonaudio and does not repeat auth/balance errors', async () => {
  await assert.rejects(new FishTtsEngine().synthesize('你好'), /FISH_AUDIO_API_KEY/);
  await assert.rejects(new FishTtsEngine({ apiKey: 'key' }).synthesize('你好'), /REFERENCE_ID/);
  assert.throws(() => new FishTtsEngine({ model: 'unknown' }), /MODEL/);
  for (const status of [401, 402, 403, 422]) {
    let calls = 0;
    const engine = new FishTtsEngine({ apiKey: 'secret', referenceId: voice, fetchImpl: async () => { calls++; return new Response('secret must not leak', { status }); } });
    await assert.rejects(engine.synthesize('你好'), error => !error.message.includes('secret') && error.message.includes(String(status)));
    assert.equal(calls, 1);
  }
  const engine = new FishTtsEngine({ apiKey: 'key', referenceId: voice, fetchImpl: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(engine.synthesize('你好'), /未返回 MP3/);
  const missingVoice = new FishTtsEngine({ apiKey: 'key', referenceId: voice, fetchImpl: async () => new Response(JSON.stringify({ message: 'Reference not found' }), { status: 400, headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(missingVoice.synthesize('你好'), /音色不存在或不可用/);
});

test('Fish retries transient rate limits once and aborts timed out requests', async () => {
  let calls = 0;
  const engine = new FishTtsEngine({ apiKey: 'key', referenceId: voice, sleep: async () => {}, fetchImpl: async () => ++calls === 1 ? new Response('', { status: 429 }) : mp3() });
  await engine.synthesize('你好'); assert.equal(calls, 2);
  const slow = new FishTtsEngine({ apiKey: 'key', referenceId: voice, timeoutMs: 15, fetchImpl: async (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }) });
  await assert.rejects(slow.synthesize('你好'), /超时/);
});

function makeService(config = {}, fishOverride) {
  const calls = [];
  const edge = { synthesize: async () => { calls.push('edge'); return Buffer.from('edge'); }, setParameters() {}, isVoiceSupported: id => id.startsWith('zh-') };
  const fish = fishOverride || new FishTtsEngine({ apiKey: 'test', referenceId: voice, fetchImpl: async () => { calls.push('fish'); return mp3(); } });
  const service = new DanmakuTtsService({ engine: edge, engines: { edge, fish }, player: { setVolume() {}, stop() {}, close: async () => {}, play: async audio => calls.push(audio.toString()) }, config: { enabled: true, provider: 'fish', fishVoice: voice, maxTextLength: 100, ...config } });
  return { service, calls };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 25));

test('Fish routes real danmaku and preview, keeps Edge bindings separate, persists voice', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateFile = path.join(dir, 'tts.json');
  const { service, calls } = makeService({ stateFile, voiceUsers: [{ uid: '123', voice: 'zh-CN-XiaoxiaoNeural' }] });
  const event = { type: 'danmaku', uid: '123', user: '测试', text: '弹幕测试' };
  assert.deepEqual(service.resolveVoiceProfile(event), { engine: 'fish', voice, designPrompt: null });
  service.handleDanmaku(event); await tick(); service.speakTest('试听测试'); await tick();
  assert.equal(calls.filter(x => x === 'fish').length, 2);
  assert.equal(calls.includes('edge'), false);
  service.setSettings({ fishVoice: 'a'.repeat(32), rate: '+20%' });
  assert.throws(() => service.setSettings({ fishVoice: 'bad' }), /32/);
  const saved = makeService({ stateFile }).service;
  assert.equal(saved.snapshot().settings.fishVoice, 'a'.repeat(32));
  assert.equal(saved.snapshot().fishAvailable, true);
  assert.equal(JSON.stringify(saved.snapshot()).includes('apiKey'), false);
});

test('skip during pending Fish synthesis prevents late playback', async () => {
  let finish;
  const fish = { available: true, setParameters() {}, synthesize: () => new Promise(resolve => { finish = resolve; }) };
  const { service, calls } = makeService({}, fish);
  service.speakTest('测试'); await service.skip();
  finish(Buffer.from('late')); await tick();
  assert.equal(calls.includes('late'), false);
});

test('HTTP settings updates Fish voice and rejects switching without a configured key', async t => {
  const { service } = makeService();
  const server = createHttpServer({ root: path.resolve('.'), host: '127.0.0.1', port: 0, ttsService: service, ttsProviderHandler: provider => service.setProvider(provider) });
  await server.start(); t.after(() => server.stop());
  const url = `http://127.0.0.1:${server.server.address().port}`;
  const post = (endpoint, body) => fetch(url + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('/api/tts/settings', { fishVoice: 'b'.repeat(32) })).status, 200);
  assert.equal(service.state.settings.fishVoice, 'b'.repeat(32));
  assert.equal((await post('/api/tts/settings', { fishVoice: 'wrong' })).status, 400);
  assert.equal((await post('/api/tts/provider', { provider: 'fish' })).status, 200);
  service.engines.fish.apiKey = '';
  assert.equal((await post('/api/tts/provider', { provider: 'fish' })).status, 400);
});

test('invalid Fish settings over WebSocket report an error without crashing the gateway', async t => {
  const { service } = makeService();
  const biliClient = Object.assign(new EventEmitter(), { config: {}, disconnect() {} });
  const songService = Object.assign(new EventEmitter(), { snapshot: () => ({ type: 'song.state' }) });
  const gateway = createWebSocketGateway({ host: '127.0.0.1', port: 0, authToken: '', maxPayload: 16384, biliClient, songService, ttsService: service });
  await gateway.ready;
  const socket = new WebSocket(`ws://127.0.0.1:${gateway.server.address().port}`);
  t.after(async () => { socket.terminate(); await gateway.stop(); });
  await once(socket, 'open');
  const nextError = new Promise(resolve => socket.on('message', data => { const p = JSON.parse(data); if (p.type === 'error') resolve(p); }));
  socket.send(JSON.stringify({ action: 'tts.set_settings', fishVoice: 'invalid' }));
  const result = await nextError;
  assert.equal(result.code, 'INVALID_TTS_SETTINGS');
  assert.equal(socket.readyState, WebSocket.OPEN);
});


test('Fish danmaku UUID binding survives restart, isolates users, supports query/removal and reaches API', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-bind-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const uuid = 'c996fb53-42d6-4a1e-bb42-eb2e3d586711';
  const normalized = uuid.replaceAll('-', '');
  const stateFile = path.join(dir, 'tts.json');
  const config = { stateFile, voiceDesign: { enabled: false, cooldownSeconds: 0 } };
  const { service, calls } = makeService(config);
  const event = { type: 'danmaku', uid: '123', user: '测试', medal: { name: '粉丝团', lv: 1 }, text: '音色 ' + uuid };
  service.handleDanmaku(event);
  assert.equal(service.resolveVoiceProfile(event).voice, normalized);
  assert.equal(calls.length, 0, 'binding command is not synthesized');
  assert.equal(service.resolveVoiceProfile({ uid: '456' }).voice, voice);
  const restored = makeService(config).service;
  assert.equal(restored.resolveVoiceProfile(event).voice, normalized);
  restored.handleDanmaku({ ...event, text: '音色 invalid' });
  assert.equal(restored.resolveVoiceProfile(event).voice, normalized);
  restored.handleDanmaku({ ...event, uid: '0', text: '音色 ' + uuid });
  assert.equal(restored.fishBindings.has('0'), false);
  restored.handleDanmaku({ ...event, uid: '456', text: '删除音色 123' });
  assert.equal(restored.resolveVoiceProfile(event).voice, normalized);
  restored.handleDanmaku({ ...event, text: '我的音色' });
  restored.handleDanmaku({ ...event, text: '删除音色' });
  assert.equal(restored.resolveVoiceProfile(event).voice, voice);
  assert.equal(makeService(config).service.fishBindings.has('123'), false);
  let requestedVoice;
  let requestCount = 0;
  const engine = new FishTtsEngine({ apiKey: 'test', fetchImpl: async (_, init) => { requestCount++; requestedVoice = JSON.parse(init.body).reference_id; return mp3(); } });
  await engine.synthesize('测试音色', { voice: uuid });
  assert.equal(requestedVoice, normalized);
  const routed = makeService({}, engine).service;
  routed.handleDanmaku(event);
  routed.handleDanmaku({ ...event, text: '这句话使用绑定的社区音色' });
  await tick();
  assert.equal(requestedVoice, normalized);
  assert.equal(requestCount, 2, 'bound danmaku triggers a separate Fish request');
  service.setSettings({ fishVoice: uuid });
  assert.equal(service.state.settings.fishVoice, normalized);
});


test('Fish binding shares registration eligibility; rejected commands do not change bindings or speak', () => {
  const { service, calls } = makeService({ voiceDesign: { cooldownSeconds: 0 }, mimoUids: new Set(['555']) });
  const event = { type: 'danmaku', uid: '123', user: '观众', text: '音色 ' + voice };
  service.handleDanmaku(event);
  assert.equal(service.fishBindings.has('123'), false);
  assert.equal(calls.length, 0);
  service.handleDanmaku({ ...event, medal: { name: '粉丝团', lv: 1 } });
  assert.equal(service.fishBindings.get('123'), voice);
  service.handleDanmaku({ ...event, text: '音色 ' + 'a'.repeat(32) });
  assert.equal(service.fishBindings.get('123'), voice, 'unqualified replacement preserves previous binding');
  service.handleDanmaku({ ...event, uid: '555' });
  assert.equal(service.fishBindings.get('555'), voice, 'existing whitelist exemption');
  service.handleDanmaku({ ...event, uid: '666', guard: 1 });
  assert.equal(service.fishBindings.get('666'), voice, 'existing guard exemption');
  service.ownerUid = '777';
  service.handleDanmaku({ ...event, uid: '777' });
  assert.equal(service.fishBindings.get('777'), voice);
  service.adminUids.add('888');
  service.handleDanmaku({ ...event, uid: '888' });
  assert.equal(service.fishBindings.get('888'), voice);
  service.handleDanmaku({ ...event, text: '删除音色' });
  assert.equal(service.fishBindings.has('123'), false, 'users can still clear their own binding without a medal');
  assert.equal(calls.length, 0);
});


test('invalid optional Fish default does not crash startup, persisted valid settings can recover', t => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-startup-'));
 t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
 const stateFile = path.join(dir, 'tts.json');
 const { service } = makeService({ provider: 'hybrid', fishVoice: '音色页面的32位ID', stateFile });
 assert.equal(service.state.settings.fishVoice, '');
 assert.equal(service.config.provider, 'hybrid');
 assert.throws(() => service.setSettings({ fishVoice: 'bad' }), /32/);
 service.setSettings({ fishVoice: voice });
 const restored = makeService({ provider: 'hybrid', fishVoice: 'invalid', stateFile }).service;
 assert.equal(restored.state.settings.fishVoice, voice);
 assert.doesNotThrow(() => makeService({}, { setParameters() { throw Error('engine unavailable'); } }));
});


test('hybrid honors explicit Fish bindings over MIMO design without affecting unbound viewers or forced providers', async () => {
 const { service, calls } = makeService({ provider: 'hybrid', voiceDesign: { cooldownSeconds: 0 } });
 service.engines.mimo = { setParameters() {} };
 service.registry = { get: () => ({ prompt: '旧 MIMO 音色' }) };
 const event = { type:'danmaku', uid:'123', user:'测试', medal:{name:'粉丝',lv:1}, text:'音色 ' + voice };
 service.handleDanmaku(event);
 assert.deepEqual(service.resolveVoiceProfile(event), {engine:'fish',voice,designPrompt:null});
 assert.equal(service.resolveVoiceProfile({...event,uid:'456'}).engine,'mimo');
 assert.equal(service.resolveVoiceProfile({uid:'789'}).engine,'edge');
 service.handleDanmaku({...event,text:'音色测试'}); await tick();
 assert.equal(calls.filter(x => x === 'fish').length,1);
 service.config.provider='edge'; assert.equal(service.resolveVoiceProfile(event).engine,'edge');
 service.config.provider='mimo'; assert.equal(service.resolveVoiceProfile(event).engine,'mimo');
 service.config.provider='hybrid';
 service.handleDanmaku({...event,text:'我的音色'});
 assert.match(service.recent[0].reason,/Fish 音色/);
 service.handleDanmaku({...event,text:'删除音色'});
 assert.equal(service.fishBindings.has('123'),false);
 assert.equal(service.resolveVoiceProfile(event).engine,'mimo');
});


test('blocked Fish voices cannot be rebound, searched, previewed or restored from disk', async t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fish-block-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const stateFile=path.join(dir,'state.json');
 fs.writeFileSync(stateFile,JSON.stringify({provider:'hybrid',settings:{rate:'+25%'},fishBindings:{'123':voice}}));
 const {service,calls}=makeService({stateFile,fishBlockedVoices:[voice],voiceDesign:{cooldownSeconds:0}});
 assert.equal(service.fishBindings.has('123'),false);
 assert.equal(JSON.parse(fs.readFileSync(stateFile,'utf8')).fishBindings['123'],undefined);
 assert.equal(service.state.settings.rate,'+25%');
 service.engines.fish.searchVoices=async()=>[{id:voice,title:'屏蔽',author:'A'},{id:'a'.repeat(32),title:'正常',author:'B'}];
 assert.deepEqual((await service.fishSelection.search('声音')).map(x=>x.id),['a'.repeat(32)]);
 assert.throws(()=>service.fishSelection.bind('123',voice),/拉黑/);
 service.handleDanmaku({type:'danmaku',uid:'123',user:'观众',medal:{lv:1},text:'音色 '+voice});
 assert.equal(service.fishBindings.has('123'),false);
 assert.match(service.recent[0].reason,/拉黑/);
 assert.throws(()=>service.setSettings({fishVoice:voice}),/拉黑/);
 service.enqueue({text:'测试',engine:'fish',voice});await tick();assert.equal(calls.includes('fish'),false);
 service.config.provider='fish';service.state.settings.fishVoice=voice;
 assert.equal(service.resolveVoiceProfile({uid:'123'}).engine,'edge');
});
