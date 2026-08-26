// supervisor 冒烟测试用 worker：启动后很快“崩溃”（exit 1），用于验证自动重启。
console.log('[SmokeWorker] boot...');
setTimeout(() => {
  console.error('[SmokeWorker] simulated crash');
  process.exit(1);
}, 800);