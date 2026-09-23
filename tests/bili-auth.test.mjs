import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BiliAuthService, cookiesFromHeaders } from '../src/bili/auth.mjs';
import { createHttpServer } from '../src/transport/http-server.mjs';

const json = (body, headers = {}) => new Response(JSON.stringify(body), { headers });
const valid = { code: 0, data: { isLogin: true, mid: 123, uname: '测试账号' } };
function fixture(t, fetchImpl, cookie = 'SESSDATA=old') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-auth-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const auth = new BiliAuthService({ file: path.join(dir, 'auth.json'), cookie, fetchImpl });
  t.after(() => auth.stop());
  return auth;
}

test('network failure preserves credentials and is distinct from expired login', async t => {
  let mode = 'valid';
  const auth = fixture(t, async () => {
    if (mode === 'network') throw new Error('timeout');
    return json(mode === 'valid' ? valid : { code: -101, data: { isLogin: false } });
  });
  assert.equal((await auth.check()).status, 'valid');
  mode = 'network';
  assert.equal((await auth.check()).status, 'network_error');
  assert.equal(auth.cookie, 'SESSDATA=old');
  mode = 'expired';
  assert.equal((await auth.check()).status, 'expired');
  assert.equal(auth.cookie, 'SESSDATA=old');
  assert.equal(JSON.stringify(auth.snapshot()).includes('SESSDATA'), false);
});

test('QR login stores credentials atomically, emits update once, reloads before env', async t => {
  let polls = 0;
  const auth = fixture(t, async url => {
    if (url.includes('/generate')) return json({ code: 0, data: { url: 'https://passport.bilibili.com/login?test=1', qrcode_key: 'private-key' } });
    if (url.includes('/poll')) {
      polls++;
      return json({ code: 0, data: { code: 0, refresh_token: 'private-refresh' } }, {
        'Set-Cookie': 'SESSDATA=new==; Path=/; HttpOnly, bili_jct=csrf; Path=/, DedeUserID=123; Path=/',
      });
    }
    return json(valid);
  });
  let updated = 0;
  auth.on('credentials', c => { updated++; assert.match(c.cookie, /SESSDATA=new==/); assert.equal(c.uid, 123); });
  const qr = await auth.generate();
  assert.match(qr.image, /^data:image\/png;base64,/);
  assert.equal(JSON.stringify(qr).includes('private-key'), false);
  const results = await Promise.all([auth.poll(qr.id), auth.poll(qr.id)]);
  assert.equal(results[0].status, 'success');
  assert.equal(updated, 1);
  assert.equal(polls, 1);
  assert.equal((await auth.poll(qr.id)).status, 'success');
  assert.equal(updated, 1);
  const saved = JSON.parse(fs.readFileSync(auth.file));
  assert.equal(saved.refreshToken, 'private-refresh');
  const reloaded = new BiliAuthService({ file: auth.file, cookie: 'SESSDATA=stale' });
  assert.equal(reloaded.cookie, saved.cookie);
  assert.equal(JSON.stringify(results).includes('private-refresh'), false);
  assert.equal(fs.readdirSync(path.dirname(auth.file)).length, 1);
});

test('failed validation after QR success retains pending credentials and original login', async t => {
  let navOk = false;
  let polls = 0;
  const auth = fixture(t, async url => {
    if (url.includes('/generate')) return json({ code: 0, data: { url: 'https://passport.bilibili.com/', qrcode_key: 'key' } });
    if (url.includes('/poll')) { polls++; return json({ code: 0, data: { code: 0 } }, { 'Set-Cookie': 'SESSDATA=new; Path=/' }); }
    if (!navOk) throw new Error('timeout');
    return json(valid);
  });
  const qr = await auth.generate();
  await assert.rejects(auth.poll(qr.id));
  assert.equal(auth.cookie, 'SESSDATA=old');
  assert.equal(fs.existsSync(auth.file), false);
  auth.qr.nextPollAt = 0;
  navOk = true;
  assert.equal((await auth.poll(qr.id)).status, 'success');
  assert.equal(polls, 1);
});

test('expired or superseded QR cannot overwrite an account', async t => {
  const auth = fixture(t, async () => json({ code: 0, data: { url: 'https://passport.bilibili.com/', qrcode_key: 'key' } }));
  const first = await auth.generate();
  const second = await auth.generate();
  assert.equal((await auth.poll(first.id)).status, 'expired');
  auth.qr.expiresAt = 0;
  assert.equal((await auth.poll(second.id)).status, 'expired');
  assert.equal(auth.cookie, 'SESSDATA=old');
});

test('Set-Cookie parsing preserves base64 padding and expires commas', () => {
  const headers = { get: () => 'SESSDATA=a==; Expires=Wed, 21 Oct 2030 07:28:00 GMT; Path=/, bili_jct=b; Path=/' };
  assert.equal(cookiesFromHeaders(headers), 'SESSDATA=a==; bili_jct=b');
});

test('login API blocks foreign origins, form posts and static credential access', async t => {
  const auth = fixture(t, async () => json(valid));
  const http = createHttpServer({ root: path.resolve('.'), host: '127.0.0.1', port: 0, biliAuth: auth });
  await http.start();
  t.after(() => http.stop());
  const base = `http://127.0.0.1:${http.server.address().port}`;
  const foreign = await fetch(`${base}/api/bili-auth/qr`, { method: 'POST', headers: { Origin: 'https://evil.example', 'X-Bili-Control': '1' }, body: '{}' });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.headers.has('access-control-allow-origin'), false);
  assert.equal((await fetch(`${base}/api/bili-auth/check`, { method: 'POST', body: '{}' })).status, 403);
  const good = await fetch(`${base}/api/bili-auth/check`, { method: 'POST', headers: { Origin: base, 'X-Bili-Control': '1' }, body: '{}' });
  assert.equal(good.status, 200);
  assert.equal((await good.json()).status, 'valid');
  for (const url of ['/data/bilibili-auth.json', '/DATA/bilibili-auth.json', '/data./bilibili-auth.json', '/data%20/bilibili-auth.json']) assert.equal((await fetch(base + url)).status, 403);
  const state = await fetch(`${base}/api/bili-auth/state`, { headers: { Origin: 'null' } });
  assert.equal(state.headers.get('access-control-allow-origin'), 'null');
  assert.equal((await state.text()).includes('SESSDATA'), false);
});
