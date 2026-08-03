# LIVE FRAME — B站直播弹幕 H5 赛博朋克边框插件

一款专为 **OBS Studio 直播与屏幕录制** 设计的高颜值 **赛博朋克 16:9 极简直播边框与 B站实时弹幕 H5 插件**。集成了 Watch Dogs 风格终端字符乱码解码动效 (Scramble Text Engine)、全色系 RGB 动态流光 / 呼吸灯效，以及开箱即用的原生 B站 WebSocket 弹幕中继服务。

---

## 核心特性

- **16:9 赛博朋克极简边框**
  - 几何线条与黑客终端风格设计，支持无缝叠加至 OBS 游戏捕获或桌面捕获画面。
  - 支持 **RGB 流光全彩渐变**、**FX FLOW 流光**、**FX PULSE 呼吸灯** 等多重动态发光特效。

- **Scramble Text 终端乱码解码动效**
  - 弹幕弹出时附带快速字符乱码混淆与逐字解密效果（包含日文片假名 `アイウエオ`、二进制 `0101` 与终端符 `!<>-_\\/`）。
  - 动效流畅自然，提供独特的极客视觉体验。

- **原生 B站 WebSocket 动态 Token 鉴权**
  - 内置 Node.js 高性能 WebSocket 中继服务（端口 7789），支持动态请求 B站 API 提取鉴权 Token (`Opcode 7`)。
  - 原生支持 **Brotli** (`protover: 3`) 与 **Zlib** (`protover: 2`) 双重二进制数据流解压与拆包。
  - 精确解析普通弹幕 (`DANMU_MSG`)、高额送礼 (`SEND_GIFT`)、醒目留言 (`SUPER_CHAT_MESSAGE`) 及大航海勋章（舰长/提督/总督）。

- **丰富可调参数与本地持久化**
  - 实时自定义面板宽度 (W)、弹幕字体大小 (F) 与等宽/黑体/中文字体系列。
  - 支持快速调色盘与 HTML5 颜色选择器。
  - 登录凭证仅从服务端 `.env` 读取，不进入浏览器 URL 或 `localStorage`。

- **开场待机倒计时页 (standby)**
  - 阈限空间式开场：三层 Z 轴（背景鸽子群 / 中央倒计时 / 前景弹幕+粒子），异步循环防重复。
  - 倒计时结束白闪释放，可联动 OBS WebSocket 自动切换正片场景。

- **弹幕点歌姬**
  - 支持“点歌 歌名”、取消点歌、查看歌单和主播切歌等命令。
  - 内置排队、防重复、用户配额、冷却、权限控制和播放状态恢复。
  - 首版支持 `music/` 目录中的本地合法音频；网络直链默认关闭。
  - 提供独立的 OBS 正在播放浏览器源。

---

## 项目结构

```text
danmaku-frame/
├── index.html            # 16:9 赛博朋克弹幕边框 H5 前端页面 (底层源)
├── standby.html          # 开场待机倒计时页（开播前情绪缓冲，可联动 OBS 切场景）
├── matrix-danmaku.html   # 《黑客帝国》“内部消息”代码拖尾跳过飘飞弹幕 (顶层源 / UIDemo)
├── server.mjs            # 轻量启动入口
├── src/                  # 服务端模块：B站连接、协议、点歌、HTTP/WS
├── public/song-player/   # OBS 点歌播放器与管理页面
├── music/                # 用户提供的合法本地音频（默认不纳入 Git）
├── data/                 # 点歌运行状态（默认不纳入 Git）
├── tests/                # Node.js 单元测试
├── 看门狗.html            # 运行状态监控与通信检测辅助页面
├── package.json          # 项目依赖与启动脚本
└── README.md             # 项目使用指南
```

---

## 快速开始

### 1. 安装依赖与启动服务

确保已安装 [Node.js](https://nodejs.org/) (建议 v18+)，在项目根目录运行以下命令：

```bash
# 安装项目依赖
npm install

# 启动 HTTP 与 WebSocket 弹幕中继服务
npm start
```

服务启动成功后，终端将输出如下提示信息：

```text
====================================================
Danmaku-Frame H5 直播边框 HTTP 服务: http://localhost:7788
WebSocket 弹幕中继服务: ws://localhost:7789
----------------------------------------------------
页面地址: http://localhost:7788/index.html
点歌播放器: http://localhost:7788/public/song-player/
====================================================
```

### 点歌姬快速开始

1. 将有权播放的 `.mp3`、`.wav`、`.ogg`、`.m4a` 或 `.flac` 文件放入 `danmaku-frame/music/`。
2. 在根目录 `.env` 中填写主播 UID：

   ```env
   BILIBILI_OWNER_UID=你的UID
   BILIBILI_ADMIN_UIDS=房管UID1,房管UID2
   SONG_REQUEST_ENABLED=true
   SONG_BLOCKED_UIDS=
   SONG_ALLOWED_UIDS=
   SONG_BLOCKED_KEYWORDS=
   ```

3. 在 OBS 中添加浏览器源：

   ```text
   http://127.0.0.1:7788/public/song-player/
   ```

4. 观众发送 `点歌 文件名关键词`。主播或配置的管理员可以发送 `下一首`、`暂停点歌`、`继续播放`、`清空歌单`、`开启点歌`、`关闭点歌`。

管理页地址为 `http://127.0.0.1:7788/public/song-player/admin.html`。服务开放到局域网时，必须设置 `WS_AUTH_TOKEN`，并通过管理页 URL 的 `?token=...` 参数提供。

> 本项目不提供会员歌曲解锁、版权限制绕过或第三方音乐平台私有接口。请只使用已获得播放授权的音频。

---

## 在 OBS Studio 中使用

1. 打开 **OBS Studio**，在“来源”列表中点击 `+`，选择 **浏览器 (Browser Source)**。
2. 在 **URL** 输入框中填写：
   ```text
   http://localhost:7788/index.html?room=30068664&hidebar=true
   ```
3. 建议将宽度设置为 `1920`，高度设置为 `1080`（或匹配您的直播画布分辨率，如 `1280x720`）。
4. 勾选 **通过 OBS 刷新浏览器**，点击“确定”保存。

### URL 参数配置说明

可以通过在 URL 路径后拼接查询参数实现个性化效果与自动连接：

| 参数 | 说明 | 示例 |
| :--- | :--- | :--- |
| `room` | 目标 B站直播间号或长链接 | `?room=30068664` |
| `color` | 十六进制边框发光主题色 | `?color=%2300e5ff` |
| `rgb` | 是否开启 RGB 渐变流光 (`true`/`false`) | `?rgb=true` |
| `fx` | 动态灯效模式 (`none`/`flow`/`pulse`) | `?fx=flow` |
| `width` | 弹幕面板宽度 (px) | `?width=360` |
| `fontsize` | 弹幕文字字号 (px) | `?fontsize=14` |
| `hidebar` | 自动隐藏顶部控制栏 (`true`/`false`) | `?hidebar=true` |
| `autoconnect` | 加载页面时自动连接直播间 (`true`/`false`) | `?autoconnect=true` |

### 开场待机页参数 (standby.html)

| 参数 | 说明 | 示例 |
| :--- | :--- | :--- |
| `duration` | 倒计时秒数 (10–3600，默认 120) | `?duration=300` |
| `mode` | `countdown` 倒计时 / `clock` 实时时钟 | `?mode=clock` |
| `room` | 弹幕预览面板连接的直播间 | `?room=30068664` |
| `bgm` | 本地待机音乐（相对 danmaku-frame 根） | `?bgm=music/standby.mp3` |
| `obsScene` | 倒计时归零时切换的 OBS 场景名 | `?obsScene=正片` |
| `schedule` | 左下角节目安排文本 | `?schedule=20:00%20LIVE` |
| `social` | 左下角社交 ID 文本 | `?social=%40xxx` |
| `hidebar` | 隐藏顶部调试控制条 (`true`/`false`) | `?hidebar=true` |

OBS 浏览器源示例：

```text
http://localhost:7788/standby.html?duration=120&room=30068664&bgm=music/standby.mp3&obsScene=正片
```

> OBS 联动依赖根目录 `.env` 的 `OBS_WEBSOCKET_URL` / `OBS_WEBSOCKET_PASSWORD`（OBS 需开启 WebSocket 服务，默认端口 4455）。场景名也可在 `.env` 中通过 `OBS_DEFAULT_SCENE` 统一配置，页面无需再带 `obsScene` 参数。未配置时归零仅做页面内转场，不报错。

---

## 开源许可证

本项目采用 [MIT License](LICENSE) 开源许可证。
