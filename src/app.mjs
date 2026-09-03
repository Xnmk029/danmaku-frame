import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from './config/env.mjs';
import { createHttpServer } from './transport/http-server.mjs';
import { createWebSocketGateway } from './transport/websocket-gateway.mjs';
import { BiliLiveClient } from './bili/client.mjs';
import { JsonSongRepository } from './song-request/repository.mjs';
import { SongRequestService } from './song-request/song-service.mjs';
import { MusicProviderRegistry } from './music/provider-registry.mjs';
import { LocalMusicProvider } from './music/providers/local-provider.mjs';
import { DirectUrlProvider } from './music/providers/direct-url-provider.mjs';
import { WindowsMediaController } from './platform/windows-media-controller.mjs';
import { ObsProxy } from './obs/obs-proxy.mjs';
import { AmllBridge } from './ncm/amll-bridge.mjs';
import { AmllServer } from './ncm/amll-server.mjs';
import { EdgeTtsEngine } from './tts/edge-tts.mjs';
import { MimoTtsEngine } from './tts/mimo-tts.mjs';
import { WindowsPlayer } from './tts/windows-player.mjs';
import { DanmakuTtsService } from './tts/tts-service.mjs';
import { parseSongCommand } from './danmaku/command-parser.mjs';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(sourceDirectory, '..');

export function createApplication(runtimeEnv = process.env) {
  const config = loadConfig(projectRoot, runtimeEnv);
  const providers = new MusicProviderRegistry([
    new LocalMusicProvider({
      projectRoot,
      musicDirectory: config.song.musicDirectory,
    }),
    new DirectUrlProvider({ enabled: config.song.allowDirectUrls }),
  ]);
  const songService = new SongRequestService({
    config: {
      ...config.song,
      ownerUid: config.bilibili.ownerUid,
      adminUids: config.bilibili.adminUids,
    },
    repository: new JsonSongRepository(config.song.stateFile),
    providers,
  });
  const biliClient = new BiliLiveClient(config.bilibili);
  const mediaController = new WindowsMediaController({ enabled: config.song.legacyMediaKeys });
  const obsProxy = new ObsProxy({
    url: config.obs.websocketUrl,
    password: config.obs.websocketPassword,
  });
  const amllBridge = config.amll.enabled
    ? (config.amll.mode === 'client'
        ? new AmllBridge({ url: config.amll.wsUrl })
        : new AmllServer({ port: config.amll.listenPort }))
    : null;
  // TTS 引擎工厂：edge（微软 Edge 在线）| mimo（小米 MiMo-TTS v2.5）
  const createTtsEngine = (provider) => (provider === 'mimo'
    ? new MimoTtsEngine({
        apiKey: config.tts.mimoApiKey,
        baseUrl: config.tts.mimoBaseUrl,
        voice: config.tts.mimoVoice,
      })
    : new EdgeTtsEngine({
        voice: config.tts.voice,
        rate: config.tts.rate,
        pitch: config.tts.pitch,
        volume: config.tts.volume,
      }));
  const ttsEngine = createTtsEngine(config.tts.provider);
  const ttsPlayer = new WindowsPlayer({
    audioDir: path.dirname(config.tts.audioFile),
    scriptFile: path.resolve(sourceDirectory, '..', 'scripts', 'tts-player.ps1'),
    volume: config.tts.playerVolume,
  });
  const ttsService = new DanmakuTtsService({
    engine: ttsEngine,
    player: ttsPlayer,
    config: {
      ...config.tts,
      // provider 语义对齐：mimo 模式全局音色用 MIMO 音色（Edge 音色 ID 会 400）
      voice: config.tts.provider === 'mimo' ? config.tts.mimoVoice : config.tts.voice,
      // env 域 0-1（WindowsPlayer 用）→ settings 域 0-100（控制台用）
      playerVolume: Math.round(config.tts.playerVolume * 100),
      isCommandText: text => Boolean(parseSongCommand(text)),
    },
    ownerUid: config.bilibili.ownerUid,
    adminUids: config.bilibili.adminUids,
  });
  songService.on('media-key', action => {
    try {
      mediaController.press(action);
    } catch (error) {
      console.error('[MediaKey]', error.message);
    }
  });
  let gateway;

  const http = createHttpServer({
    root: projectRoot,
    host: config.host,
    port: config.httpPort,
    wsAuthToken: config.wsAuthToken,
    switchSceneHandler: async ({ scene }) => obsProxy.switchScene(scene || config.obs.defaultScene),
    coverHandler: amllBridge ? async id => amllBridge.getCoverData(id) : null,
    ttsService,
    ttsProviderHandler: (provider) => {
      if (provider !== 'edge' && provider !== 'mimo') throw new Error('provider 仅支持 edge 或 mimo');
      config.tts.provider = provider;
      const defaultVoice = provider === 'mimo' ? config.tts.mimoVoice : config.tts.voice;
      ttsService.setEngine(createTtsEngine(provider), provider, defaultVoice);
      return { provider, voice: ttsService.state.settings.voice };
    },
    autoRestartFile: config.autoRestart.switchFile,
    autoRestartDefault: config.autoRestart.enabled,
    healthProvider: () => ({
      ok: true,
      service: 'danmaku-frame',
      httpPort: config.httpPort,
      wsPort: config.wsPort,
      wsClients: gateway?.clientCount() || 0,
      songEnabled: songService.state.enabled,
      ttsEnabled: ttsService.state.enabled,
      roomId: biliClient.roomId || null,
    }),
  });

  return {
    config,
    http,
    biliClient,
    songService,
    obsProxy,
    ttsService,
    async start() {
      await http.start();
      try {
        gateway = createWebSocketGateway({
          host: config.host,
          port: config.wsPort,
          authToken: config.wsAuthToken,
          maxPayload: config.maxWsMessageBytes,
          biliClient,
          songService,
          amllBridge,
          ttsService,
        });
        await gateway.ready;
      } catch (error) {
        await http.stop();
        throw error;
      }
      await ttsService.start();
      console.log('====================================================');
      console.log(`[DanmakuFrame] HTTP: http://${config.host}:${config.httpPort}`);
      console.log(`[WebSocket] Relay: ws://${config.host}:${config.wsPort}`);
      console.log(`[SongPlayer] 点歌播放器: http://${config.host}:${config.httpPort}/public/song-player/`);
      console.log(`[AMLL] 播放信息: ${config.amll.enabled ? config.amll.wsUrl : '已禁用'}`);
      console.log(`[BilibiliAuth] B站鉴权: ${config.bilibili.cookie ? '服务端登录态' : '匿名'}`);
      console.log(`[TTS] 弹幕朗读: ${config.tts.enabled ? `开启 (${config.tts.voice})` : '关闭 (TTS_ENABLED=false)'}`);
      console.log(`[AutoRestart] 崩溃自动重启: ${config.autoRestart.enabled ? '开启' : '关闭'}`);
      console.log('====================================================');
    },
    async stop() {
      if (gateway) await gateway.stop();
      await ttsService.stop();
      await obsProxy.disconnect();
      await http.stop();
    },
  };
}
