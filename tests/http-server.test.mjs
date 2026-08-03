import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { isPublicStaticPath, resolveStaticPath } from '../src/transport/http-server.mjs';

test('static resolver keeps requests inside the configured root', () => {
  const root = path.resolve('danmaku-frame');
  assert.equal(resolveStaticPath(root, '/../package.json'), null);
  assert.equal(resolveStaticPath(root, '/%2e%2e/package.json'), null);
  assert.equal(resolveStaticPath(root, '/index.html'), path.join(root, 'index.html'));
});

test('malformed URI is rejected', () => {
  assert.equal(resolveStaticPath(path.resolve('danmaku-frame'), '/%E0%A4%A'), null);
});

test('static allowlist blocks source, state, dependencies, and dotfiles', () => {
  const root = path.resolve('danmaku-frame');
  assert.equal(isPublicStaticPath(root, path.join(root, '.git', 'config')), false);
  assert.equal(isPublicStaticPath(root, path.join(root, 'src', 'app.mjs')), false);
  assert.equal(isPublicStaticPath(root, path.join(root, 'data', 'song-state.json')), false);
  assert.equal(isPublicStaticPath(root, path.join(root, 'node_modules', 'ws', 'index.js')), false);
  assert.equal(isPublicStaticPath(root, path.join(root, 'package.json')), false);
  assert.equal(isPublicStaticPath(root, path.join(root, 'public', 'song-player', 'index.html')), true);
  assert.equal(isPublicStaticPath(root, path.join(root, 'music', 'song.mp3')), true);
});
