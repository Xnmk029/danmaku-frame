// 配置持久化 + 开机自启
const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(process.env.APPDATA || '.', 'LiveControl');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  theme: 'dark',          // dark | light
  closeToTray: true,
  autoStart: false,
  windowWidth: 1100,
  windowHeight: 720,
  selectedServiceId: null,
  logsExpanded: true,
  standby: {
    duration: 120,        // 待机页倒计时秒数（10~3600，对应 standby.html?duration=）
    mode: 'countdown',    // countdown | clock
    scene: '',            // 倒计时归零后 OBS 切换的场景名
  },
  face: {
    capture: '0',         // 摄像头 ID（facetracker --capture）
    fps: 24,
    model: 3,             // 追踪模型 0~4
    visualize: true,      // false = 无预览窗口模式（--visualize 0）
    maxThreads: 4,
  },
  obs: {
    url: 'ws://127.0.0.1:4455',
    password: '',         // 从 G:/产品/OBS/.env 自动读取，可在面板覆盖
    browserSource: '',    // 留空 = 自动查找含 standby.html 的浏览器源
  },
};

function load() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
    }
  } catch { /* 损坏回退默认 */ }
  return { ...DEFAULTS };
}

// 从 G:/产品/OBS/.env 读取 OBS WebSocket 默认配置（仅首次无配置时用）
function loadObsFromEnv() {
  try {
    const envPath = 'G:/产品/OBS/.env';
    if (!fs.existsSync(envPath)) return null;
    const text = fs.readFileSync(envPath, 'utf8');
    const get = (k) => {
      const m = text.match(new RegExp('^' + k + '\\s*=\\s*(.+)$', 'm'));
      return m ? m[1].trim() : '';
    };
    return {
      url: get('OBS_WEBSOCKET_URL') || null,
      password: get('OBS_WEBSOCKET_PASSWORD') || null,
    };
  } catch { return null; }
}

function save(config) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch { /* 忽略 */ }
}

module.exports = { load, save, loadObsFromEnv, CONFIG_PATH };
