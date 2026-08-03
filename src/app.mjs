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
    healthProvider: () => ({
      ok: true,
      service: 'danmaku-frame',
      wsClients: gateway?.clientCount() || 0,
      songEnabled: songService.state.enabled,
      roomId: biliClient.roomId || null,
    }),
  });

  return {
    config,
    http,
    biliClient,
    songService,
    obsProxy,
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
        });
        await gateway.ready;
      } catch (error) {
        await http.stop();
        throw error;
      }
      console.log('====================================================');
      console.log(`🚀 Danmaku-Frame: http://${config.host}:${config.httpPort}`);
      console.log(`📡 WebSocket: ws://${config.host}:${config.wsPort}`);
      console.log(`🎵 点歌播放器: http://${config.host}:${config.httpPort}/public/song-player/`);
      console.log(`🔐 B站鉴权: ${config.bilibili.cookie ? '服务端登录态' : '匿名'}`);
      console.log('====================================================');
    },
    async stop() {
      if (gateway) await gateway.stop();
      await obsProxy.disconnect();
      await http.stop();
    },
  };
}
