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
  - 内置 Node.js 高性能 WebSocket 中继服务（端口 8787），支持动态请求 B站 API 提取鉴权 Token (`Opcode 7`)。
  - 原生支持 **Brotli** (`protover: 3`) 与 **Zlib** (`protover: 2`) 双重二进制数据流解压与拆包。
  - 精确解析普通弹幕 (`DANMU_MSG`)、高额送礼 (`SEND_GIFT`)、醒目留言 (`SUPER_CHAT_MESSAGE`) 及大航海勋章（舰长/提督/总督）。

- **丰富可调参数与本地持久化**
  - 实时自定义面板宽度 (W)、弹幕字体大小 (F) 与等宽/黑体/中文字体系列。
  - 支持快速调色盘与 HTML5 颜色选择器。
  - 支持 SESSDATA 凭证登录，规避 B站 游客弹幕打码限制。

---

## 项目结构

```text
danmaku-frame/
├── index.html            # 16:9 赛博朋克弹幕边框 H5 前端页面 (底层源)
├── matrix-danmaku.html   # 《黑客帝国》“内部消息”代码拖尾跳过飘飞弹幕 (顶层源 / UIDemo)
├── server.mjs            # Node.js HTTP 静态服务 (8080) + B站 WebSocket 弹幕中继服务 (8787)
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
Danmaku-Frame H5 直播边框 HTTP 服务: http://localhost:8080
WebSocket 弹幕中继服务: ws://localhost:8787
----------------------------------------------------
页面地址: http://localhost:8080/index.html
====================================================
```

---

## 在 OBS Studio 中使用

1. 打开 **OBS Studio**，在“来源”列表中点击 `+`，选择 **浏览器 (Browser Source)**。
2. 在 **URL** 输入框中填写：
   ```text
   http://localhost:8080/index.html?room=30068664&hidebar=true
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

---

## 开源许可证

本项目采用 [MIT License](LICENSE) 开源许可证。
