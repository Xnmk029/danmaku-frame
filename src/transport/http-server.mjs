import http from 'http';
import fs from 'fs';
import path from 'path';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
};

function resolveStaticPath(root, requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }

  const relativePath = decoded.replace(/^[/\\]+/, '');
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const prefix = `${resolvedRoot}${path.sep}`;
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(prefix)) return null;
  return resolvedPath;
}

function isPublicStaticPath(root, targetPath) {
  const relative = path.relative(path.resolve(root), path.resolve(targetPath));
  if (!relative || relative === '.') return true;
  const segments = relative.split(path.sep);
  if (segments.some(segment => segment.startsWith('.'))) return false;

  const blockedDirectories = new Set(['src', 'tests', 'data', 'node_modules', 'DOCS']);
  if (blockedDirectories.has(segments[0])) return false;

  const blockedFiles = new Set(['server.mjs', 'package.json', 'package-lock.json', 'README.md']);
  return !(segments.length === 1 && blockedFiles.has(segments[0]));
}

function isLoopbackAddress(address = '') {
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1';
}

function readJsonBody(request, limit = 8192) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!chunks.length) { resolve({}); return; }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('请求体必须是合法 JSON'));
      }
    });
    request.on('error', reject);
  });
}

function writeJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

export function createHttpServer({
  root,
  host,
  port,
  healthProvider = () => ({ ok: true }),
  switchSceneHandler = null,
  wsAuthToken = '',
  coverHandler = null,
  ttsService = null,
  autoRestartFile = '',
  autoRestartDefault = true,
}) {
  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // CORS：允许本地桌面控制台（LiveControl Electron renderer / file:// 页面）跨源调用 API。
    // 仅放行回环来源请求；非回环请求不带 CORS 头（保持浏览器同源保护 + token 鉴权）。
    const loopbackRequest = isLoopbackAddress(req.socket.remoteAddress || '');
    if (loopbackRequest) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // POST 仅用于控制端点（OBS 场景切换联动 / TTS / 自动重启开关）
    if (req.method === 'POST') {
      if (parsedUrl.pathname === '/api/obs/switch-scene' && switchSceneHandler) {
        handleSwitchScene(req, res, { switchSceneHandler, wsAuthToken });
        return;
      }
      if (parsedUrl.pathname === '/api/tts/enabled' && ttsService) {
        handleJsonControl(req, res, wsAuthToken, async body => {
          ttsService.setEnabled(Boolean(body.enabled), { persist: true });
          return { ok: true, enabled: Boolean(body.enabled) };
        });
        return;
      }
      if (parsedUrl.pathname === '/api/tts/settings' && ttsService) {
        handleJsonControl(req, res, wsAuthToken, async body => {
          ttsService.setSettings({
            voice: body.voice,
            rate: body.rate,
            pitch: body.pitch,
            volume: body.volume,
            playerVolume: body.playerVolume,
            gain: body.gain,
          }, { persist: true });
          return { ok: true, settings: ttsService.state.settings };
        });
        return;
      }
      if (parsedUrl.pathname === '/api/tts/test' && ttsService) {
        handleJsonControl(req, res, wsAuthToken, async body => {
          ttsService.speakTest(body.text);
          return { ok: true };
        });
        return;
      }
      // 调试/复现端点：注入一条“真实弹幕”走完整过滤链（handleDanmaku）
      if (parsedUrl.pathname === '/api/tts/inject' && ttsService) {
        handleJsonControl(req, res, wsAuthToken, async body => {
          ttsService.handleDanmaku({
            type: 'danmaku',
            uid: String(body.uid || '0'),
            user: body.user || '测试用户',
            text: String(body.text || ''),
            admin: false,
            guard: Number(body.guard || 0),
            medal: body.medal || null,
            receivedAt: Date.now(),
          });
          return { ok: true, stats: ttsService.stats };
        });
        return;
      }
      if (parsedUrl.pathname === '/api/tts/skip' && ttsService) {
        handleJsonControl(req, res, wsAuthToken, async () => {
          await ttsService.skip();
          return { ok: true };
        });
        return;
      }
      if (parsedUrl.pathname === '/api/auto-restart') {
        handleJsonControl(req, res, wsAuthToken, async body => {
          if (typeof body.enabled !== 'boolean') throw new Error('缺少 enabled 布尔值');
          const file = resolveAutoRestartFile(autoRestartFile);
          fs.writeFileSync(file, JSON.stringify({ enabled: body.enabled }, null, 2));
          return { ok: true, enabled: body.enabled };
        });
        return;
      }
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD, POST /api/obs/switch-scene' });
      res.end('405 Method Not Allowed');
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
      res.end('405 Method Not Allowed');
      return;
    }

    if (parsedUrl.pathname === '/healthz') {
      writeJson(res, 200, healthProvider());
      return;
    }

    if (parsedUrl.pathname === '/api/tts/state' && ttsService) {
      writeJson(res, 200, ttsService.snapshot());
      return;
    }

    if (parsedUrl.pathname === '/api/tts/diag' && ttsService) {
      ttsService.diag()
        .then(result => writeJson(res, 200, result))
        .catch(error => writeJson(res, 500, { ok: false, error: error.message }));
      return;
    }

    if (parsedUrl.pathname === '/api/auto-restart') {
      writeJson(res, 200, { enabled: readAutoRestartEnabled(autoRestartFile, autoRestartDefault) });
      return;
    }

    // AMLL 封面缓存端点（data 型封面由服务端持有，前端经此加载，天然免防盗链）
    if (parsedUrl.pathname === '/api/ncm/cover' && coverHandler) {
      handleCover(req, res, parsedUrl, coverHandler);
      return;
    }

    let targetPath = resolveStaticPath(root, parsedUrl.pathname);
    if (!targetPath || !isPublicStaticPath(root, targetPath)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('403 Forbidden');
      return;
    }

    try {
      const stats = fs.statSync(targetPath);
      if (stats.isDirectory()) targetPath = path.join(targetPath, 'index.html');
    } catch {
      if (!path.extname(targetPath)) targetPath = path.join(targetPath, 'index.html');
    }

    fs.readFile(targetPath, (error, data) => {
      if (error) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`404 Not Found: ${parsedUrl.pathname}`);
        return;
      }

      res.writeHead(200, {
        'Content-Type': MIME_TYPES[path.extname(targetPath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': targetPath.endsWith('.html') ? 'no-cache' : 'public, max-age=300',
      });
      if (req.method === 'HEAD') res.end();
      else res.end(data);
    });
  });

  server.on('error', error => console.error('[HTTP] Server error:', error.message));

  return {
    server,
    start: () => new Promise((resolve, reject) => {
      const onError = error => {
        server.removeListener('error', onError);
        reject(error);
      };
      server.once('error', onError);
      server.listen(port, host, () => {
        server.removeListener('error', onError);
        resolve();
      });
    }),
    stop: () => new Promise(resolve => server.close(() => resolve())),
  };
}

async function handleSwitchScene(req, res, { switchSceneHandler, wsAuthToken }) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    writeJson(res, 400, { ok: false, error: error.message });
    return;
  }

  // 鉴权：本机回环免 token；远程必须携带与 WS_AUTH_TOKEN 一致的 token
  const isLoopback = isLoopbackAddress(req.socket.remoteAddress || '');
  if (!isLoopback && (!wsAuthToken || payload.token !== wsAuthToken)) {
    writeJson(res, 401, { ok: false, error: 'UNAUTHORIZED' });
    return;
  }

  try {
    const result = await switchSceneHandler({ scene: payload.scene });
    writeJson(res, 200, { ok: true, ...result });
  } catch (error) {
    writeJson(res, 502, { ok: false, error: error.message });
  }
}

async function handleCover(req, res, parsedUrl, coverHandler) {
  const id = parsedUrl.searchParams.get('id') || '';
  if (!id) {
    writeJson(res, 400, { ok: false, error: '缺少 id 参数' });
    return;
  }
  const cover = await coverHandler(id);
  if (!cover) {
    writeJson(res, 404, { ok: false, error: '封面不存在或已过期' });
    return;
  }
  res.writeHead(200, {
    'Content-Type': cover.mime || 'image/jpeg',
    'Cache-Control': 'public, max-age=3600',
  });
  res.end(Buffer.from(cover.data, 'base64'));
}

async function handleJsonControl(req, res, wsAuthToken, handler) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    writeJson(res, 400, { ok: false, error: error.message });
    return;
  }

  // 鉴权：本机回环免 token；远程必须携带与 WS_AUTH_TOKEN 一致的 token
  const isLoopback = isLoopbackAddress(req.socket.remoteAddress || '');
  if (!isLoopback && (!wsAuthToken || payload.token !== wsAuthToken)) {
    writeJson(res, 401, { ok: false, error: 'UNAUTHORIZED' });
    return;
  }

  try {
    const result = await handler(payload);
    writeJson(res, 200, result);
  } catch (error) {
    writeJson(res, 400, { ok: false, error: error.message });
  }
}

function resolveAutoRestartFile(configuredFile) {
  if (configuredFile) return configuredFile;
  return path.resolve(process.cwd(), 'data', 'auto-restart.json');
}

function readAutoRestartEnabled(configuredFile, fallback) {
  try {
    const file = resolveAutoRestartFile(configuredFile);
    if (fs.existsSync(file)) {
      const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
      return payload.enabled !== false;
    }
  } catch (error) {
    console.error('[HTTP] 读取自动重启开关失败:', error.message);
  }
  return fallback !== false;
}

export { isLoopbackAddress, readJsonBody, writeJson, handleCover };
export { isPublicStaticPath, resolveStaticPath };
