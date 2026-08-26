import { createApplication } from './src/app.mjs';

const app = createApplication();
let shuttingDown = false;

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[DanmakuFrame] 收到 ${signal}，正在安全退出...`);
  try {
    await app.stop();
    process.exitCode = exitCode;
  } catch (error) {
    console.error('[DanmakuFrame] 退出失败:', error);
    process.exitCode = 1;
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', error => {
  console.error('[DanmakuFrame] 未捕获异常:', error);
  // 未捕获异常视为崩溃（exit 1），supervisor 才会自动重启
  shutdown('uncaughtException', 1);
});
process.on('unhandledRejection', reason => {
  console.error('[DanmakuFrame] 未处理 Promise 拒绝:', reason);
});

app.start().catch(error => {
  console.error('[DanmakuFrame] 启动失败:', error);
  process.exitCode = 1;
});
