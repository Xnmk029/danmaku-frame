# 现有边框 → PHASE demo 功能迁移分析

依据：当前 index.html、public/voice-selection/card.js，以及用户提供的 C:/Users/Administrator/Downloads/边框.html。仅静态源码分析，未改动页面、未连接真实 OBS，未验证浏览器效果和性能。demo 内说明文字作为分析对象，不作为用户指令。

## 结论

保留 demo 的 Canvas 纹理、A/B/C 布局、前后层与配置工具；增加实时数据适配层和 DOM 直播信息层。不能只把消息传入 setChat 就视为迁移完成。

## 现有边框全部功能与迁移对应

| 功能 | 现有实现 | demo 状态 | 迁移处理 |
| --- | --- | --- | --- |
| 房间连接 | 房间号/链接解析、默认房间、连接/断开、自动连接、3秒重连 | 无 WS | 抽取 RelayClient；正式配置统一房间，恢复连接后重订阅 |
| 快捷测试房间 | 一键切到官方6号 | 无 | 放调试页；不进入播出画面 |
| 连接状态 | OFFLINE、连接反馈、房间、人气显示 | LOCAL PREVIEW 等静态字样 | 新增真实连接状态和人气绑定，区分演示/实时 |
| 聊天事件 | danmaku、gift、sc；其他统计/进场不进聊天列表 | 仅 name/text | 保留 type，分别设计普通弹幕、礼物、SC 样式 |
| 消息缓冲 | DOM 最多50条 | 最多接收100条，内部留50条 | 用独立消息缓冲管理；按布局决定可见条数 |
| 用户名 | 中英混排字体分类、匿名名处理 | 截断至18字符 | 保留正常昵称与匿名回退；不沿用粉丝牌+等级猜测身份的缓存 |
| 粉丝牌 | 名称、等级 | 无 | 增加紧凑徽标，不能在映射时丢弃 medal |
| 舰长身份 | guard 类与对应视觉样式，实际效果受后续CSS覆盖 | 无 | 保留 guard 字段，融入 demo 的徽标设计 |
| 内嵌表情 | emots 按文本分段，支持不同尺寸；加载失败回退文字 | Canvas 纯文本 | DOM 富文本消息；动态图片交给浏览器渲染 |
| 大表情 | bigEmote 图片，高度限制24–96px | 无 | 专用消息行及加载失败回退 |
| 礼物与SC | 类型样式，正文展示，不是独立置顶/计费卡系统 | 无 | 先等价迁移；若增加置顶或专用提示，需要新增逻辑 |
| 清空/测试 | 清空当前页面；本地随机示例，不发平台弹幕 | 可编辑样例 | 保留调试功能，样例与实时缓冲分离 |
| 歌曲卡 | 曲名、歌手、封面、超长滚动、进度、时长、播放指示 | 无 | 新增媒体卡组件 |
| 歌曲订阅 | ncm.subscribe，ncm.playback/offline；进度按updatedAt插值 | 无 | 复用事件协议；暂停/无歌曲时现版隐藏，可先保持 |
| 音色选择 | voice.selection：搜索、最多3候选、作者、编号、倒计时、成功/失败/超时 | 无 | 复用 VoiceSelectionCard 状态处理，重做样式与尺寸 |
| 音色与音乐互斥 | 候选卡临时占用歌曲卡位置；结束恢复音乐；断线超时解除覆盖 | 无 | 新增共享信息槽，音色候选优先于歌曲 |
| 当前/下一项/模型 | 三个独立可编辑字段，整栏显隐 | topic/subtitle/showTopic | current可映射topic；next、model必须新增独立字段 |
| 品牌 | 本地鸟图标、XNMK等标签 | XOMK字形、PHASE标签 | 品牌文案统一；当前两者拼写不同，列为设计项 |
| 主题 | 深浅主题、localStorage记忆 | auto/light/negative | light→light，dark→negative，保留auto按布局选择 |
| 强调色 | 预设色/自定义色、RGB循环 | 固定纹理调色板、主题accent | 新增信息层accent即可；RGB不是纹理流动的等价项，作为可选兼容项 |
| 边框灯效 | none/flow/pulse | warp/cycle/material/reduced，局部glitch | 原视觉由 demo 替代；flow、pulse无一一对应，不能静默假装兼容 |
| 背景效果 | 网格、字符节点、扫描线、随机glitch、CRT/暗角 | 像素欧普、套准标记、划痕、受限glitch | 保留 demo 视觉，避免两套背景叠加 |
| 文字效果 | Scramble 解码、行轻抖、数字/符号高亮 | 静态Canvas文本 | 可选迁移高亮；默认简化入场动画，适配reduced |
| 装饰遥测 | CPU/MEM/NET随机数，SYS静态ONLINE | 静态设计标签 | 不作为真实监控迁移；替换为真实状态或保留明确装饰文案 |
| 字号/字体/宽度 | 滑条、字体菜单、URL参数 | 固定布局和字体 | 增加按布局设置的聊天字号；宽度受安全区域约束 |
| 隐藏控制台 | hidebar和切换按钮 | view=program | 使用demo播出模式，并确保全部工具按钮都不上屏 |
| URL启动 | 14个参数 | view/scene/layer/clock/cfg/theme/time | 增加旧参数映射；冲突优先级必须明确 |

现有边框不承担弹幕发送、TTS合成播放、平台开关播、真实Live2D驱动、OBS场景切换。这些属于控制台、后台或独立源，不需要搬入画面。

## demo 可直接复用的能力

- 1920×1080 Canvas，A内容与角色、B专注内容、C人物与聊天。
- back：带背景的后景，A/B内容区清透明洞；并非整层透明。C没有内容洞。
- front：透明前景，包含近侧纹理、框、标记、标题、聊天、话题。
- composite：带静态立绘、导入媒体的合成预览。
- 纹理material、grid、warp、op、cycle、markers、scars、weave、reduced；场景转场约0.6秒。
- glitch约140ms，1.5秒冷却，任意60秒最多4次，B和reduced禁用。
- 静态立绘导入/缩放/负片；内容图片和静音循环视频预览、contain/cover。
- 配置JSON导入导出、带cfg的输出URL、PNG、12秒无声Canvas录像。
- 开发API window.phaseStudio：setScene、setConfig、setChat、getConfig、loadConfig、getLayout、getOutputURL、getState、renderAt/renderFrame、play/pause/seek等。
- getConfig返回包含schemaVersion、design、config、chat、chatSource的包装对象；不能直接把整个返回值当setConfig参数。
- engine.ready 是内部素材准备Promise；window.phaseStudio在初始化完成后才发布，ready字段是true，不是Promise。适配层应等待初始化信号再调用。

## 最大迁移缺口：聊天不是富消息

setChat会把每条消息重建为{name,text}，丢弃其他字段；昵称截18字符、正文截240字符。只替换数据源只能得到简化文本版，无法保留现有功能。

建议存储标准消息对象：type、uid、user、text、medal、guard、emots、bigEmote、receivedAt，以及礼物/SC专有字段。消息进入缓冲后，由布局组件选择显示；用textContent和明确的图片节点渲染，不照搬旧版用户名/粉丝牌拼innerHTML的做法。

## 三种布局的承载能力

| 布局 | 内容区域 x/y/w/h | 当前聊天区域及数量 | 建议 |
| --- | --- | --- | --- |
| A | 72/132/1344/756 | 1468/130/354/148；2条 | 常规内容场景。聊天区域偏小，歌曲/候选卡须另预留区域，不覆盖右侧角色脸部 |
| B | 72/132/1536/864 | 1664/142/194/115；0条 | 现版只画FOCUS MODE及圆点，showChat=true也无正文。保留专注默认，增加可选紧凑提示模式 |
| C | 无内容窗 | 1312/232/490/425；5条 | 主聊天场景。右栏增加歌曲/候选卡，重新分配聊天与话题高度 |

不能直接把三候选音色卡塞入A的148px聊天区或B的194px宽栏。正式迁移需设计明确的信息槽位置与优先级，不静默隐藏已有音色交互。

## 推荐技术结构

1. Canvas视觉层：继续负责纹理、框、前后穿插与转场。
2. DOM信息层：聊天富文本、徽标、表情、音乐、候选音色卡、项目文案；基于1920×1080统一坐标缩放。
3. 数据适配层：复用7789 WS及7788封面/状态接口，明确消息类型，处理重连。
4. LiveControl：控制配置和OBS源绑定；不把管理控件绘制进输出画面。

正式front/composite显示DOM信息；back不重复显示或订阅不需要的直播数据。接入DOM后关闭Canvas原drawChat及迁移走的drawTopic/header区域，避免两份文字重叠。

混合层的代价：原canvas.toBlob/captureStream只导出Canvas，不能捕获DOM信息层。PNG/WebM按钮需明确导出范围；完整直播画面以OBS录制为准，或另做完整导出实现。不能保留原按钮却声称可导出所有新信息。

## OBS分层与布局联动

从底到顶：内容源 → back网页 → 透明角色源 → front网页。

- front/back使用同一布局和配置版本。demo的clock=wall用系统时间对齐循环纹理，不能同步全部配置、glitch事件或转场起点。
- BroadcastChannel仅在共享浏览器环境内有效，不能作为Electron/外部浏览器/OBS之间的控制总线；当前也不广播glitch事件。
- A/B/C改变内容窗和角色位置。phaseStudio.setScene只改变网页布局，不修改OBS内容源/角色源的变换。
- 第一版建议OBS预建三个对应场景，各自固定布局与源变换；后续才考虑批量更新网页配置和OBS变换。
- demo人物是静态图；avatarScale/negativeCharacter只作用于网页占位图，不影响外部Live2D。
- 近侧笔画避脸区域按静态图比例估算；真实Live2D动作需要独立可调安全区。

## 配置与素材处理

- demo单文件约875KB，含内嵌素材。迁移时可拆HTML/样式/引擎/适配层/素材，保留原文件作参考。
- 本地导入媒体使用blob URL，不写入配置JSON；另一浏览器或OBS不会随配置自动得到该素材。正式资源放到服务可访问的固定路径，或继续用OBS独立媒体源。
- cfg包含聊天快照，不适合持续塞实时弹幕；新输出配置只保存展示设置，实时消息走WS。
- 配置兼容建议：current→topic；next/model扩展；theme dark→negative；hidebar→program；room/autoconnect由适配层处理；fontsize/font/width落入布局受限的聊天样式。
- color/rgb/fx分别评估为兼容选项，不能机械对应op/warp/cycle。
- demo现有setConfig会忽略DEFAULTS之外字段，所以新增业务字段需扩展配置schema或置于独立broadcast配置层。

## 实施顺序与验收

1. 新建独立phase页面，保留旧入口；接通状态、普通弹幕与显式演示模式。
2. 完成富消息、徽标、表情、礼物/SC、歌曲卡及音色候选卡，逐项验证不丢功能。
3. 完成A/B/C的信息槽布局、项目文案、主题/字号设置与配置兼容。
4. LiveControl分别绑定front/back源，预建对应OBS场景并核对内容与角色位置。
5. 测试长昵称/长消息、表情失败、SC、候选卡超时恢复、断线重连、空房间、前后层一致性、1080p及720p文字可读性。
6. OBS实际测量双Canvas性能；根据结果限制刷新率、降低网格成本。不能仅凭源码承诺帧率。

不应将demo的scene A/B/C当OBS scene名称，也不应复用待机页obsScene参数代表网页布局。
