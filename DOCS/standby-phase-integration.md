# PHASE / HOLD 待机页：参考页修正版

视觉基准为用户提供的 Downloads/待机页.html，规范副本为 phase-signal-design.md。直接保留参考页数字路径、XOMK遮罩、纹理、人物前后穿插、面部保护、0.5秒归零停留和0.9秒反色转场。上一版双栏设计已撤回。

人物使用用户原GIF：960×720、108帧、4.5秒循环。参考中的修复GIF没有随附件提供，未虚构修复结果。通过参考已有ImageDecoder和帧预算解码，按原帧时长播放，关闭二次重定时。素材失败时原控制台显示回退状态。

## 地址

- 正式：`http://127.0.0.1:7788/standby.html?duration=120&obsScene=目标场景`
- 安全预览：`http://127.0.0.1:7788/standby.html?duration=120&preview=true`
- 原制作控制台：`http://127.0.0.1:7788/standby.html?editor=1`
- 时钟：`mode=clock`，四位字形显示HH:MM，不切OBS。
- 手动切场景：`autoSwitch=false`，归零后保持XOMK。
- 不自动开始：`autostart=0`。
- 保留room、bgm；可用chat=false、music=false隐藏附加信息。

preview=true及editor=1均不订阅真实房间、不播放BGM、不切OBS。默认只输出原Canvas，不带制作界面或退出按钮。编辑模式保留参考页开始/暂停/重置、定帧、配置、PNG、录像能力。

独立适配器public/standby/integration.js连接7789，订阅弹幕和歌曲，3秒断线重连。弹幕/礼物/SC最多两条微型文字，20秒过期；大表情用文字占位，内嵌表情保留名称。歌曲显示曲名、歌手、当前进度。未添加封面、信息卡、侧栏，以保留参考构图。新增文字绘制在原Canvas中，因此可随PNG/录像导出。

正式倒计时归零1.4秒后请求一次OBS切场景，保留完整反色转场。暂停、定帧、预览、时钟不会触发。失败不自动无限重试，重置后可再次请求。空obsScene仍使用服务端默认场景。

LiveControl改动仍在用户指定G:/产品/LiveControl：安全预览、独立保存按钮、应用前保存、禁止回退修改无关浏览器源。已构建，未重打安装包、未修改另一份livecontrol，需重启源码版控制台加载。

验证脚本scripts/verify/verify-reference.cjs使用无头Edge、真实页面/素材和模拟后端，检查108帧解码、白态00:08、黑态XOMK、预览隔离、切场景延迟与单次请求、实时文字/音乐、720p时钟、无脚本异常。截图为tmp/qa/reference-*.png。未操作真实OBS或重启直播服务；实际OBS性能和音频自动播放尚待联调。

旧版public/standby/legacy.html保留供回退（不具备新预览隔离）。

## 制作控制台应用到输出页

制作控制台顶部新增“保存并应用到 OBS”“重新开始倒计时”“复制 OBS 页面地址”。首次给 OBS 浏览器源设置复制的地址（不要带editor/preview），已打开的旧页面需刷新一次以加载新版适配器。后续保存无需刷新OBS页面，约1秒内拉取新参数，并回报接收状态。确认数代表输出页面实例，不代表经过OBS身份验证的进程。

外观保存不改变当前倒计时的时长、进度、暂停状态或人物动画相位；新时长由独立重启按钮生效。时钟模式接收外观配置，但忽略倒计时重启。页面初次加载不会重放旧重启指令；显式URL duration优先于保存时长，无duration则读取保存值。

GET/POST /api/standby/config负责读取/保存，POST /api/standby/restart发一次重启指令，POST /api/standby/ack记录输出接收。配置存于data/standby-config.json，原子替换写入，参数有白名单和范围校验。保存包括渲染设置与人物播放方式，不上传制作页临时导入的动画文件；默认人物仍为已部署的原GIF。

新增验证：配置持久化/非法输入、HTTP接口、双页面保存与确认、保存不重置倒计时、主动重启采用新时长、刷新不重放重启。总计151项Node测试通过。
