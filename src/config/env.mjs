import fs from 'fs';
import path from 'path';

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};

  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }

  return result;
}

function asInteger(value, fallback, { min = 0, max = 65535 } = {}) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function asBoolean(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function asList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

export function loadConfig(projectRoot, runtimeEnv = process.env) {
  const fileEnv = parseEnvFile(path.resolve(projectRoot, '..', '.env'));
  const env = { ...fileEnv, ...runtimeEnv };
  const cookie = env.BILIBILI_COOKIE?.trim()
    || (env.BILIBILI_SESSDATA?.trim() ? `SESSDATA=${env.BILIBILI_SESSDATA.trim()}` : '');

  return {
    projectRoot,
    host: env.HOST?.trim() || '127.0.0.1',
    httpPort: asInteger(env.PORT, 8080),
    wsPort: asInteger(env.WS_PORT, 7789),
    wsAuthToken: env.WS_AUTH_TOKEN?.trim() || '',
    maxWsMessageBytes: asInteger(env.WS_MAX_MESSAGE_BYTES, 16_384, { min: 1024, max: 1_048_576 }),
    bilibili: {
      cookie,
      uid: asInteger(env.BILIBILI_UID, 0, { max: Number.MAX_SAFE_INTEGER }),
      buvid: env.BILIBILI_BUVID?.trim() || '',
      defaultRoomId: env.BILIBILI_ROOM_ID?.trim() || '30068664',
      ownerUid: env.BILIBILI_OWNER_UID?.trim() || '',
      adminUids: new Set(asList(env.BILIBILI_ADMIN_UIDS)),
    },
    obs: {
      websocketUrl: env.OBS_WEBSOCKET_URL?.trim() || '',
      websocketPassword: env.OBS_WEBSOCKET_PASSWORD?.trim() || '',
      defaultScene: env.OBS_DEFAULT_SCENE?.trim() || '',
    },
    amll: {
      enabled: asBoolean(env.NCM_ENABLED, true),
      // server: 监听端口接收 AMLL-WS-Connector 推送（推荐）；client: 连接 AMLL Player
      mode: env.AMLL_MODE?.trim() === 'client' ? 'client' : 'server',
      wsUrl: env.AMLL_WS_URL?.trim() || 'ws://127.0.0.1:11444',
      listenPort: asInteger(env.AMLL_LISTEN_PORT, 11444, { min: 1024, max: 65535 }),
    },
    song: {
      enabled: asBoolean(env.SONG_REQUEST_ENABLED, true),
      musicDirectory: path.resolve(projectRoot, env.SONG_MUSIC_DIR?.trim() || 'music'),
      stateFile: path.resolve(projectRoot, env.SONG_STATE_FILE?.trim() || 'data/song-state.json'),
      maxQueueLength: asInteger(env.SONG_MAX_QUEUE_LENGTH, 50, { min: 1, max: 500 }),
      maxPerUser: asInteger(env.SONG_MAX_PER_USER, 2, { min: 1, max: 20 }),
      cooldownMs: asInteger(env.SONG_COOLDOWN_SECONDS, 30, { max: 86_400 }) * 1000,
      maxDurationSeconds: asInteger(env.SONG_MAX_DURATION_SECONDS, 600, { min: 30, max: 86_400 }),
      allowDirectUrls: asBoolean(env.SONG_ALLOW_DIRECT_URLS, false),
      legacyMediaKeys: asBoolean(env.SONG_LEGACY_MEDIA_KEYS, false),
      blockedUids: new Set(asList(env.SONG_BLOCKED_UIDS)),
      allowedUids: new Set(asList(env.SONG_ALLOWED_UIDS)),
      blockedKeywords: asList(env.SONG_BLOCKED_KEYWORDS).map(item => item.toLocaleLowerCase('zh-CN')),
    },
    tts: {
      // 弹幕朗读（Edge TTS 在线合成 + Windows 本地播放）
      enabled: asBoolean(env.TTS_ENABLED, false),
      voice: env.TTS_VOICE?.trim() || 'zh-CN-XiaoxiaoNeural',
      rate: env.TTS_RATE?.trim() || '+0%',
      pitch: env.TTS_PITCH?.trim() || '+0Hz',
      volume: env.TTS_VOLUME?.trim() || '+0%',
      playerVolume: asInteger(env.TTS_PLAYER_VOLUME, 100, { min: 0, max: 100 }) / 100,
      maxTextLength: asInteger(env.TTS_MAX_TEXT_LENGTH, 60, { min: 10, max: 500 }),
      skipCommands: asBoolean(env.TTS_SKIP_COMMANDS, true),
      blockedUids: new Set(asList(env.TTS_BLOCKED_UIDS)),
      blockedKeywords: asList(env.TTS_BLOCKED_KEYWORDS).map(item => item.toLocaleLowerCase('zh-CN')),
      dedupeWindowMs: asInteger(env.TTS_DEDUPE_SECONDS, 10, { min: 0, max: 300 }) * 1000,
      cooldownMs: asInteger(env.TTS_COOLDOWN_SECONDS, 3, { min: 0, max: 300 }) * 1000,
      audioFile: path.resolve(projectRoot, env.TTS_AUDIO_FILE?.trim() || 'data/tts/current.mp3'),
      stateFile: path.resolve(projectRoot, env.TTS_STATE_FILE?.trim() || 'data/tts-state.json'),
    },
    autoRestart: {
      enabled: asBoolean(env.AUTO_RESTART_ENABLED, true),
      switchFile: path.resolve(projectRoot, env.AUTO_RESTART_SWITCH_FILE?.trim() || 'data/auto-restart.json'),
    },
  };
}

export function getCookieValue(cookie, name) {
  const item = String(cookie || '')
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${name}=`));
  return item ? item.slice(name.length + 1) : '';
}
