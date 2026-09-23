import test from 'node:test';
import assert from 'node:assert/strict';
import { DanmakuTtsService } from '../src/tts/tts-service.mjs';
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup(concurrency = 3) {
  const requests = [], plays = [];
  const makeEngine = name => ({ setParameters() {}, synthesize(text, options) {
    return new Promise((resolve, reject) => requests.push({ name, text, options, resolve: () => resolve(Buffer.from(text)), reject }));
  } });
  const edge = makeEngine('edge'), fish = makeEngine('fish'), mimo = makeEngine('mimo');
  const player = { setVolume() {}, play(audio) { return new Promise(resolve => plays.push({ text: audio.toString(), resolve })); }, stop() { plays.at(-1)?.resolve(); }, async close() { this.stop(); } };
  const service = new DanmakuTtsService({ engine: edge, engines: { edge, fish, mimo }, player, config: { enabled: true, synthConcurrency: concurrency } });
  const add = (text, engine = 'fish', voice = text) => service.enqueue({ uid: text, user: text, text, engine, voice });
  return { service, requests, plays, add };
}

test('three syntheses overlap, completion order does not change playback order; audio prefetch continues during playback', async () => {
  const { service, requests, plays, add } = setup();
  for (const x of ['A','B','C','D']) add(x);
  assert.deepEqual(requests.map(r => r.text), ['A','B','C']);
  assert.equal(service.snapshot().synthesizingCount, 3);
  requests[2].resolve(); await flush();
  assert.deepEqual(requests.map(r => r.text), ['A','B','C','D']);
  requests[1].resolve(); requests[3].resolve(); await flush();
  assert.equal(plays.length, 0);
  requests[0].resolve(); await flush();
  assert.deepEqual(plays.map(p => p.text), ['A']);
  assert.equal(service.snapshot().readyCount, 3);
  for (let i = 0; i < 4; i++) { plays[i].resolve(); await flush(); }
  assert.deepEqual(plays.map(p => p.text), ['A','B','C','D']);
  assert.equal(service.snapshot().spokenCount, 4);
  assert.equal(service.snapshot().synthesizingCount, 0);
  assert.deepEqual(requests.map(r => r.options.voice), ['A','B','C','D']);
});

test('skipping pending synthesis moves to ready audio immediately and late audio never plays', async () => {
  const { service, requests, plays, add } = setup();
  add('A'); add('B'); requests[1].resolve(); await flush();
  await service.skip(); await flush();
  assert.equal(plays[0].text, 'B');
  requests[0].resolve(); plays[0].resolve(); await flush();
  assert.deepEqual(plays.map(p => p.text), ['B']);
  assert.equal(service.snapshot().spokenCount, 1);
});

test('disable clears ready and in-flight jobs; later preview works without reviving old audio', async () => {
  const { service, requests, plays, add } = setup();
  add('A'); add('B'); requests[1].resolve(); await flush();
  service.setEnabled(false); await flush();
  add('preview'); requests[2].resolve(); await flush();
  requests[0].resolve(); await flush();
  assert.deepEqual(plays.map(p => p.text), ['preview']);
  plays[0].resolve(); await flush();
  assert.equal(service.snapshot().queueCount, 0);
});

test('failed synthesis advances playback and shared Edge client stays serial while HTTP jobs overlap', async () => {
  const { service, requests, plays, add } = setup();
  add('E1','edge'); add('E2','edge'); add('F','fish'); add('M','mimo');
  assert.deepEqual(requests.map(r => r.text), ['E1','F','M']);
  requests[0].reject(new Error('test failure')); await flush();
  assert.equal(requests[3].text, 'E2');
  for (const i of [1,2,3]) requests[i].resolve(); await flush();
  for (let i = 0; i < 3; i++) { plays[i].resolve(); await flush(); }
  assert.deepEqual(plays.map(p => p.text), ['E2','F','M']);
  assert.equal(service.snapshot().lastError, '');
});

test('queue overflow and shutdown discard prepared audio without exceeding concurrency', async () => {
  const { service, requests, plays, add } = setup(2);
  for (let i = 0; i < 12; i++) add(String(i));
  assert.equal(requests.length, 2);
  assert.equal(service.queue.length, 8);
  await service.stop();
  for (const r of requests) r.resolve(); await flush();
  assert.equal(requests.length, 2);
  assert.equal(plays.length, 0);
  assert.equal(service.snapshot().synthesizingCount, 0);
});
