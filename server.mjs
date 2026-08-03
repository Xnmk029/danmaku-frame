import { createApplication } from './src/app.mjs';

const app = createApplication();
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[DanmakuFrame] 收到 ${signal}，正在安全退出...`);
  try {
    await app.stop();
    process.exitCode = 0;
  } catch (error) {
    console.error('[DanmakuFrame] 退出失败:', error);
    process.exitCode = 1;
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', error => {
  console.error('[DanmakuFrame] 未捕获异常:', error);
  shutdown('uncaughtException');
});
process.on('unhandledRejection', reason => {
  console.error('[DanmakuFrame] 未处理 Promise 拒绝:', reason);
});

app.start().catch(error => {
  console.error('[DanmakuFrame] 启动失败:', error);
  process.exitCode = 1;
});
