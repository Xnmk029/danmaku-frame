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

/** 解析音色-等级区间映射："21-40:zh-CN-X,11-20:zh-CN-Y" → [{min,max,voice}]（高区间优先）。 */
function parseVoiceTiers(raw) {
  const tiers = [];
  if (!raw) return tiers;
  for (const part of String(raw).split(',')) {
    const m = /^\s*(\d+)\s*-\s*(\d+)\s*:\s*([A-Za-z0-9_-]+)\s*$/.exec(part);
    if (!m) {
      console.warn(`[Config] 忽略非法音色区间: ${part}`);
      continue;
    }
    tiers.push({ min: Number(m[1]), max: Number(m[2]), voice: m[3] });
  }
  tiers.sort((a, b) => b.min - a.min);
  return tiers;
}

/** 解析用户级音色预设："用户名:音色,uid:音色" → [{uid,name,voice}]。键为纯数字按 UID 匹配，否则按原始用户名匹配。 */
function parseVoiceUsers(raw) {
  const users = [];
  if (!raw) return users;
  for (const part of String(raw).split(',')) {
    const colon = part.lastIndexOf(':');
    if (colon <= 0) {
      console.warn(`[Config] 忽略非法用户音色预设: ${part}`);
      continue;
    }
    const key = part.slice(0, colon).trim();
    const voice = part.slice(colon + 1).trim();
    if (!key || !voice) {
      console.warn(`[Config] 忽略非法用户音色预设: ${part}`);
      continue;
    }
    users.push(/^\d+$/.test(key) ? { uid: key, voice } : { name: key, voice });
  }
  return users;
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
      // 引擎：edge（微软 Edge 在线）| mimo（小米 MiMo-TTS v2.5）
      provider: env.TTS_PROVIDER?.trim() || 'edge',
      voice: env.TTS_VOICE?.trim() || 'zh-CN-XiaoxiaoNeural',
      rate: env.TTS_RATE?.trim() || '+0%',
      pitch: env.TTS_PITCH?.trim() || '+0Hz',
      volume: env.TTS_VOLUME?.trim() || '+0%',
      playerVolume: asInteger(env.TTS_PLAYER_VOLUME, 100, { min: 0, max: 100 }) / 100,
      // MIMO（小米 MiMo-TTS v2.5）配置
      mimoApiKey: env.MIMO_API_KEY?.trim() || '',
      mimoBaseUrl: env.MIMO_API_BASE_URL?.trim() || 'https://api.xiaomimimo.com/v1',
      mimoVoice: env.MIMO_VOICE?.trim() || 'mimo_default',
      maxTextLength: asInteger(env.TTS_MAX_TEXT_LENGTH, 60, { min: 10, max: 500 }),
      skipCommands: asBoolean(env.TTS_SKIP_COMMANDS, true),
      blockedUids: new Set(asList(env.TTS_BLOCKED_UIDS)),
      blockedKeywords: asList(env.TTS_BLOCKED_KEYWORDS).map(item => item.toLocaleLowerCase('zh-CN')),
      dedupeWindowMs: asInteger(env.TTS_DEDUPE_SECONDS, 10, { min: 0, max: 300 }) * 1000,
      cooldownMs: asInteger(env.TTS_COOLDOWN_SECONDS, 3, { min: 0, max: 300 }) * 1000,
      // 声音增益 100-150%：映射为 Edge SSML volume（+0% ~ +50%）
      gainPercent: asInteger(env.TTS_GAIN_PERCENT, 100, { min: 100, max: 150 }),
      // 朗读前缀：粉丝牌 → 用户名；舰长 → "舰长"
      readPrefix: asBoolean(env.TTS_READ_PREFIX, true),
      // 音色-等级绑定：舰长专属音色 + 等级区间映射（音色必须属于 Edge 支持集）
      voiceGuard: env.TTS_VOICE_GUARD?.trim() || '',
      voiceTiers: parseVoiceTiers(env.TTS_VOICE_TIERS),
      // 用户级音色预设（最高优先级）：TTS_VOICE_USERS=用户名:音色,uid:音色
      voiceUsers: parseVoiceUsers(env.TTS_VOICE_USERS),
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
