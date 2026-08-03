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
}) {
  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // POST 仅用于 OBS 场景切换联动端点（开场待机页归零触发）
    if (req.method === 'POST') {
      if (parsedUrl.pathname === '/api/obs/switch-scene' && switchSceneHandler) {
        handleSwitchScene(req, res, { switchSceneHandler, wsAuthToken });
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
    start: () => new Promise(resolve => server.listen(port, host, resolve)),
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

export { isLoopbackAddress, readJsonBody, writeJson };
export { isPublicStaticPath, resolveStaticPath };
