---
title: "PHASE / SIGNAL · XOMK 直播与视频视觉系统"
version: "2.0"
date: "2026-09-17"
status: "以倒计时 HTML 与实际输出截图为一级视觉基准"
language: "zh-CN"
medium: "直播待机、L2D 直播包装、倒计时、片头、章节转场、视频包装"
canonicalReferences:
  - "countdown-readable.png"
  - "final-negative.png"
  - "PHASE / HOLD countdown HTML"
---

# PHASE / SIGNAL 2.0
## XOMK · Pixel Op-Art Broadcast System

> **大字形是空间，像素材质在字形内部流动；留白建立秩序，glitch 只留下短促伤痕。**

本版规范以已经实现的倒计时 HTML 及其实际输出截图作为**一级视觉依据**，取代之前较宽泛的“赛博 UI / 科技 HUD”理解。

核心不是“未来科技界面”，而是：

**实验印刷感 × 超细长字形 × 像素欧普材质 × 大面积负空间 × 微型校准标记 × 克制 glitch × 人物/字形穿插。**

任何后续直播边框、L2D 布局、视频包装和图像生成，都应该先回答一个问题：

> **如果去掉所有按钮、窗口框和信息卡，这一帧是否仍然能被认成倒计时页面的同一套视觉系统？**

若不能，则说明偏离了本风格。

---

# 00 · 一级视觉基准

## 0.1 Canonical Look A · LIGHT / COUNTDOWN

亮色倒计时画面是日常状态的首要参考。

其关键视觉特征：

- 接近纯白的背景，占据绝大部分画面；
- 中央是**极高、极窄、轮廓稳定的大字形/数字**；
- 彩色欧普、黑白条纹、棋盘格、像素块只主要存在于字形内部；
- 主体之外只有极少量横向彩色细线、十字准星、四色套准块；
- 顶部与底部存在非常小的等宽说明文字，但不形成 HUD 面板；
- 人物可以与字形发生前后穿插，但不破坏倒计时数字整体可读性；
- 画面气质更像“实验海报 / 数字丝网印刷 / 动起来的排版作品”，而不是游戏 UI。

### 视觉比例起点

- **75%–85%：**纯白或极低细节负空间；
- **12%–20%：**中央主字形及人物；
- **1%–3%：**校准标记、微型文字与 glitch scars。

这里的比例是视觉密度关系，不是严格像素面积计算。

---

## 0.2 Canonical Look B · NEGATIVE / XOMK

黑底 XOMK 是高潮、待机完成态、章节收束和视觉演出状态的首要参考。

其关键视觉特征：

- 背景接近纯黑，而不是渐变深蓝科技面板；
- XOMK 保持与倒计时数字同源的超细长、垂直延展字形；
- 字形内部继续保持**电蓝、青、品红、白、少量酸黄绿 + 黑白欧普纹**；
- 人物可进入负片或部分负片状态，但 XOMK 本体不被简单粗暴整页反相；
- 人物依旧与字形前后交错；
- 边缘校准标记继续存在，但数量极少；
- 黑底不是为了制造“赛博空间”，而是为了让高饱和彩色字形和人物负片形成摄影暗房般的反转状态。

### 黑态的核心词

**纯黑、负片、发光感来自色块本身，不来自 Bloom。**

禁止把黑态自动理解成：

- 黑蓝玻璃面板；
- 霓虹 HUD；
- 赛博朋克城市；
- 大量发光描边；
- 半透明卡片；
- 金属边框。

---

# 01 · 风格定义

## 1.1 一句话定义

**一套以“超大细长字形作为空间骨架”，将高饱和像素欧普纹理限制在字形内部，并以大量留白和少量 glitch 校准痕迹形成识别度的广播视觉系统。**

## 1.2 风格关键词

必须优先想到：

- elongated glyphs / 超细长字形
- pixel op-art / 像素欧普
- optical interference / 视觉干涉
- registration marks / 印刷套准标记
- negative space / 大面积负空间
- editorial experimental typography / 实验编辑排版
- hard pixel edges / 硬边像素
- black-white optical stripes / 黑白欧普条纹
- electric cyan / cobalt / magenta
- sparse glitch scars / 稀疏故障伤痕
- interleaved depth / 前后穿插

不应该优先想到：

- cyberpunk HUD
- sci-fi dashboard
- glassmorphism
- esports overlay
- streamer gamer frame
- neon panel grid
- futuristic cockpit

---

# 02 · 构图 DNA

## 2.1 主体永远先是“大形”，不是“面板”

一个镜头首先只能有 **1 个主导视觉大形**：

- `MM:SS`；
- `XOMK`；
- 一个超大环形 O；
- 一组连续细长字形；
- 一个超大像素波面。

其余信息必须依附于大形，而不是与大形竞争。

### 禁止

不要把页面拆成：

- 顶栏 + 左侧栏 + 主窗口 + 右侧聊天框 + 底部播放器 + 信息卡；
- 4–8 个等权面板；
- 到处都有边框的直播 HUD。

这正是上一轮 L2D 布局预览偏离风格的主要原因。

---

## 2.2 负空间是风格的一部分

白态和黑态都必须保留明显“空”的区域。

**空白不是未设计，而是用来放大字形、人物和 glitch 痕迹的对比。**

1080p 基准中：

- 外围至少留出约 5% 的纯净边缘；
- 主字形之外，不要被 UI 元素填满；
- 单个角落最多放一组小型校准元素；
- 小文字只沿顶部、底部或极少数基线排列。

---

## 2.3 构图方向：垂直骨架，水平伤痕

本系统的视觉张力来自两种方向的冲突：

### 垂直

- 超高细长字形；
- 长环；
- 竖向像素带；
- 人物身体或姿态的长轴。

### 水平

- 2–40 px 的 glitch 断线；
- 极短横向彩色像素划痕；
- 少量文字基线；
- 切片位移。

**垂直负责结构，水平负责破坏。**

---

# 03 · 字形系统

## 3.1 字形不是字体装饰，而是主场景

倒计时数字和 XOMK 应当被视为“图形建筑”。

其特征：

- 极高；
- 极窄；
- 圆角或连续曲线处有明显长环；
- 大内部镂空；
- 笔画粗细足够承载复杂纹理；
- 字符之间保持明显空隙；
- 允许人物进入字腔和字符间隙。

数字与 XOMK 应共享同一种比例语言。

## 3.2 推荐比例

以单字形包围盒为例：

- 高宽比约 **3:1–5:1**；
- 主笔画视觉宽度约为字宽的 **15%–28%**；
- 字符间距不小于主笔画宽度；
- 字腔必须足以形成清晰的“穿过”空间。

这不是传统字体排版要求，而是视觉装置尺度。

## 3.3 不允许

- 普通无衬线大粗体直接贴纹理；
- 方正电竞字体；
- chrome / 金属 3D 字；
- 外发光描边字；
- 全字符随机破碎；
- 每秒更换完全不同的字形骨架。

---

# 04 · 像素欧普材质

## 4.1 材质只在“容器”里爆发

最重要的规则：

> **高密度欧普纹理应该被字形、环、波幕或明确遮罩收纳。背景本身保持安静。**

这样才能形成倒计时截图里最关键的“白底 / 黑底 vs 高密度彩色笔画”的对比。

## 4.2 三类纹理必须混合

### A · 彩色像素带

颜色以硬边块状形式沿笔画纵向流动：

- cobalt blue
- electric blue
- cyan
- aqua
- magenta
- violet
- 少量 acid yellow-green
- white

### B · 黑白欧普

包括：

- 正弦弯曲条纹；
- 黑白斜纹；
- 扭曲棋盘格；
- 波纹式条带；
- 高对比重复细胞。

黑白欧普不应覆盖全部字形，通常只占局部 15%–40%。

### C · 低分辨率色块

4–12 px 网格中的：

- 方块；
- 条块；
- 阶梯边；
- 受限抖色。

它们用来把连续欧普纹和数字媒介感连接起来。

---

## 4.3 基础网格

1080p 输出：

- 默认 `4 px`；
- `6 px` 用于更明显的像素块；
- `8 px` 用于强段落；
- `12 px` 只用于短暂重组或极粗画面。

字形轮廓可以是连续曲线，但内部采样与切片必须尽量对齐基础网格。

---

# 05 · 色彩系统 2.0

## 5.1 Broadcast Palette

| Token | 建议值 | 用途 |
|---|---|---|
| `paper` | `#FDFEFD` | LIGHT 主背景 |
| `black` | `#020102` | NEGATIVE 主背景 |
| `deepBlue` | `#010540` | 字形暗部 |
| `cobalt` | `#0017F7` | 核心蓝 |
| `electricBlue` | `#006EFF` | 中间亮蓝 |
| `cyan` | `#00FCFA` | 最高亮冷色 |
| `aqua` | `#4DFFF7` | 青白过渡 |
| `magenta` | `#FF00EB` | 主要暖侧强调 |
| `violet` | `#9C00FF` | 局部过渡 |
| `acid` | `#B3FF03` | 极少量校准/故障节点 |
| `white` | `#FAFEFD` | 欧普亮条 |
| `opBlack` | `#010319` | 欧普暗条 |

## 5.2 用色比例

单一字形内部的起点：

- 蓝 / 青族：50%–70%；
- 黑白欧普：15%–30%；
- 品红 / 紫：8%–18%；
- acid：0%–5%。

酸黄绿永远是“跳出来的一点”，不能成为主色。

## 5.3 背景不要有渐变

默认：

- LIGHT = 接近纯白；
- NEGATIVE = 接近纯黑。

不要为了丰富画面加入：

- 蓝黑径向渐变；
- 发光雾；
- 星空颗粒；
- 科技网格铺满背景；
- 大面积紫蓝氛围光。

---

# 06 · 校准标记与微型信息

## 6.1 它们是“印刷/实验痕迹”，不是 UI

允许出现：

- 十字准星；
- 2×2 四色套准块；
- 1–2 px 竖向点列；
- 10–50 px 彩色横线；
- 极小等宽英文；
- 极少数坐标式编号。

## 6.2 分布方式

推荐：

- 左上 / 右上：一组 2×2 彩块；
- 上中 / 下中：一个十字准星；
- 左右边缘中段：一组小横线或短点列；
- 左下 / 右下：极小状态标签。

不要每个角落都变成信息面板。

## 6.3 微型文字

字体：等宽或接近等宽无衬线。

视觉要求：

- 很小；
- 字距略开；
- 灰蓝低对比；
- 多为全大写英文或短标签；
- 只做辅助，不承担唯一关键信息。

示例：

```text
X O M K / STREAM STANDBY
STARTS IN 00:08
PIXEL OP-ART / INTERLEAVED ALPHA
SIGNAL HOLD / LOOP ACTIVE
```

---

# 07 · Glitch 语言

## 7.1 Glitch 是“伤痕”，不是滤镜

视觉上应像：

- 某一行像素被横向扯出；
- RGB 某一通道短暂错位；
- 一小条彩色扫描断点；
- 某一笔画局部错层；
- 少量边缘出现像素毛刺。

它不应该像：

- 整屏 VHS；
- 全屏雪花；
- 全局 RGB split；
- CRT 扫描线；
- 持续抖屏；
- 每一秒都闪烁。

## 7.2 位置规则

Glitch 优先发生在：

- 字形边缘；
- 字形内部纹理边界；
- 左右画面边缘；
- 模式切换遮罩边界。

尽量不发生在：

- 人脸；
- 字幕；
- 真实测试内容；
- 关键数字整体轮廓。

## 7.3 参数起点

- 单次时长：`80–180 ms`；
- 横移：`8–32 px`；
- 同时切片：1–3 条；
- 面积：通常 < 10%；
- 冷却：至少约 1.5 秒；
- 不使用整屏反白作为 glitch。

---

# 08 · 动效语言

## 8.1 第一层：字形静止，表面流动

这是整个系统最重要的持续运动。

**轮廓大体固定，纹理坐标沿笔画内部缓慢移动。**

默认：

- 周期 `8–16 s`；
- 推荐基准 `12 s`；
- 纹理位移 `8–16 px`；
- 不让完整字形像旗帜一样大幅摆动。

## 8.2 第二层：数字切换

倒计时每秒改变时：

- 只变化对应数字；
- 起动快，回落慢；
- 一次轻微上跳或受压；
- 约 `280–420 ms` 完成；
- 推荐垂直幅度 `20–32 px`；
- 不震动整个画布。

## 8.3 第三层：节点事件

跨分钟、最后十秒、归零、章节切换时才允许更明显事件：

- 局部 glitch；
- 像素重组；
- 切片；
- 色彩状态切换；
- LIGHT → NEGATIVE。

普通每秒减数不触发 glitch。

## 8.4 LIGHT → NEGATIVE

倒计时完成后推荐：

1. `00:00` 停留约 `0.4–0.6 s`；
2. 一个单向、明确的像素/遮罩交接约 `0.7–1.0 s`；
3. 背景进入纯黑；
4. XOMK 取代数字；
5. 人物运动相位不中断；
6. 字形内部相位流动继续。

切换不使用全屏白闪。

---

# 09 · 人物 / L2D 与字形关系

## 9.1 人物不是“贴在 UI 上”

人物应当进入主图形空间。

正确关系：

**远侧字形笔画 → 人物 → 近侧字形笔画 → 微型信息。**

这样人物像穿过字形，而不是贴在数字前面。

## 9.2 有环字形是天然的空间门

`0 / 6 / 8 / 9 / O` 以及 XOMK 中的环形结构优先用于：

- 人物头部或手臂穿过字腔；
- 身体从某一笔画后方进入；
- 局部衣摆被前景笔画覆盖。

这是本系统最有辨识度的空间处理之一。

## 9.3 人脸保护

即使做穿插：

- 眼睛、嘴部、主要面部轮廓不应被高对比黑白条带切断；
- 允许头发边缘与笔画交错；
- 前景遮挡更多发生在肩、衣摆、手臂、腿部；
- 人脸周围应降低纹理密度。

## 9.4 页面不要给人物额外的大幅平移

L2D 或源动画自身已经提供动作时：

- 页面根位置保持稳定；
- 额外横移建议 `0–60 px`；
- 额外纵移建议 `0–16 px`；
- 默认不做持续旋转；
- 默认不做持续缩放呼吸。

动作来自角色，不来自“整个 PNG 飘来飘去”。

---

# 10 · 直播边框如何继承这套风格

## 10.1 直播边框不是传统框

“边框”应被理解成**少量图形锚点和局部遮罩**，而不是四周围一圈复杂装饰。

推荐构成：

- 1 个大内容窗口；
- 1 个 L2D 主体；
- 1 个超大局部字形/环形背景；
- 少量校准标记；
- 少量微型状态文字；
- 1–2 个局部 glitch 区。

## 10.2 内容窗口边缘

只允许：

- 1–2 px 细线；
- 某两个角存在像素断裂；
- 某一边有 20–100 px 的欧普片段；
- 其余保持干净。

不要：

- 厚电竞框；
- 四角机械结构；
- 发光边框；
- 六边形科技装饰；
- 多层玻璃卡片。

## 10.3 聊天区

聊天不要形成大黑框 HUD。

更适合：

- 无底色或极简透明列；
- 每条信息由一条短横线或小色块定位；
- 用户名用 cobalt/cyan；
- 正文保持白/黑中性色；
- 最多同时突出 2–4 条。

聊天密集时切换到专门聊天场景，而不是把主画面永久压成多栏 UI。

---

# 11 · Controller UI 与 Broadcast Canvas 必须分离

倒计时 HTML 里的白色控制面板属于**制作工具界面**，并不属于直播成片风格。

这是以后生成视觉稿时必须明确区分的两套东西：

## A. Controller UI

可以是：

- 浅灰白；
- 普通表单；
- 蓝色 focus ring；
- 下拉菜单；
- 滑杆；
- 网页后台布局。

它的目标是可操作。

## B. Broadcast Canvas

必须遵循：

- 白/黑纯场；
- 超大细长字形；
- 欧普纹理限制在主形；
- 极少量微型信息；
- 大量负空间；
- 人物穿插；
- 无传统 HUD 卡片。

**图片生成时，如果目标是“直播边框预览”，默认生成的是 B，不允许把 A 的网页控制台外观带入成片。**

---

# 12 · 三种广播场景的正确泛化

## 12.1 CONTENT / 内容主场景

适用于游戏、软件、视频、模型测试。

视觉原则：

- 内容窗口是最大矩形，但边框极薄；
- L2D 位于一侧，人物后方是一段裁切后的超长 `O / M / K` 或数字环；
- 背景保持纯白或纯黑；
- 欧普纹理不绕完整内容窗口跑一圈；
- 微型状态标签沿顶部或底部一条基线布置。

内容窗口不需要“科技框”，只需要被这套图形语言轻轻定位。

## 12.2 FOCUS / 内容优先

适用于代码、细节演示。

- 内容占 80%–90%；
- L2D 缩小到边角；
- XOMK 只露出 1–2 个巨大局部笔画；
- glitch 几乎关闭；
- 校准痕迹仍然保留，因此即使很安静也能认出风格。

## 12.3 CHARACTER / 人物互动

适用于闲聊、弹幕互动。

- 人物变成大主体；
- 聊天文字成为第二主体；
- 背后用一个完整的长环 O 或 XOMK 局部；
- 不把聊天放入传统矩形卡片；
- 让人物、环形字腔、聊天列形成三层深度。

---

# 13 · 图像生成规范

以后使用图像模型生成“本风格直播包装”时，应在提示词中明确：

## 必须出现

- minimalist experimental broadcast layout
- huge elongated typographic forms
- pixel op-art texture confined inside typography
- warped black-and-white optical stripes
- electric cobalt, cyan, magenta, tiny acid green accents
- pure white or pure black negative space
- sparse registration marks
- tiny monospaced calibration labels
- subtle horizontal glitch scars
- hard pixel edges
- large quiet negative space
- 2.5D interleaving between character and typography

## 必须排除

- cyberpunk HUD
- sci-fi dashboard
- glass UI panels
- esports streaming overlay
- neon glowing frame
- futuristic cockpit UI
- many cards and widgets
- complex top navigation
- metallic border
- holographic interface
- dense information panels

## 参考提示词骨架

```text
Experimental minimalist live-broadcast composition derived from a moving pixel-op-art poster.
Pure white [or pure black] field with large quiet negative space.
One oversized group of extremely tall narrow typographic forms acts as the main spatial structure.
The glyph strokes contain hard-edged 4px pixel mosaics, electric cobalt blue, cyan, magenta, white, tiny acid-green accents, warped black-and-white Op-Art stripes and checker interference.
Outside the glyphs the screen stays almost empty, with only sparse print registration crosses, tiny CMYK-like calibration squares, a few 1–2px horizontal glitch scars, and tiny low-contrast monospaced labels.
The Live2D character is not inside a gamer panel: the character physically interleaves with the giant glyphs, with some strokes behind the body and selected near-side strokes in front, while the face remains unobstructed.
Editorial experimental typography, digital screen-print aesthetic, hard pixels, high contrast, clean composition, no bloom.
NO cyberpunk HUD, NO esports frame, NO glass panels, NO dashboard cards, NO neon border, NO dense sci-fi UI.
```

---

# 14 · Motion Presets

## `standard`

- 纹理周期：12 s
- warp：14 px
- 数字跳动：约 28 px
- glitch：仅关键节点
- 人物额外平移：≤ 55 px
- 主背景：稳定

## `quiet`

- 纹理周期：16–24 s
- warp：4–8 px
- 字形不跳或只微跳
- glitch：关闭
- 人物额外平移：0–20 px

## `hero`

- 纹理周期：8–12 s
- warp：16–24 px
- 局部像素重组
- 允许 1 次短 glitch
- 黑白欧普占比可提高
- 仍不允许整屏抖动或 bloom

## `negative`

- 背景纯黑
- 字形高饱和度
- 人物可负片/局部负片
- 校准标记保留
- 微型文字降低亮度
- 不增加额外 HUD

---

# 15 · Do / Don’t

## DO

- 先画一个巨大字形，再决定信息放哪；
- 让纹理在字形里运动；
- 让背景保持纯净；
- 用 4 px 网格建立数字质感；
- 用黑白欧普制造局部视觉震荡；
- 用品红和 acid 做极小强调；
- 用校准十字和四色块代替科幻图标；
- 让人物与字形产生真实的前后层；
- 把 glitch 当成瞬时事件；
- 黑态直接使用黑，而不是黑蓝渐变。

## DON’T

- 不要做“VTuber 电竞直播模板”；
- 不要全屏多窗口 HUD；
- 不要大量矩形卡片；
- 不要发光蓝色边框；
- 不要赛博朋克玻璃面板；
- 不要把欧普条纹铺满整个背景；
- 不要将 glitch 变成持续噪声；
- 不要让人物根节点持续大幅横移；
- 不要在人物脸上穿过高对比条纹；
- 不要把“复杂”当作“有设计感”。

---

# 16 · 工程层级

推荐所有实时工程保持以下图层概念：

```text
L0  BASE
    pure white / pure black

L1  FAR GLYPH
    远侧字形笔画 / XOMK / number masks

L2  ART MATERIAL
    pixel op-art texture / phase flow

L3  CHARACTER / CONTENT
    L2D / video / evidence

L4  NEAR GLYPH
    近侧穿插笔画

L5  GLITCH SCARS
    局部切片 / edge scars

L6  MICRO TYPE
    calibration labels / status / subtitle

L7  SAFETY
    face protection / subtitle protection / content masks
```

真实内容和人物不应被重新送入全局 glitch 滤镜。

---

# 17 · 1080p 默认令牌

```yaml
designSystem: phase-signal-xomk
version: 2.0
canvas:
  width: 1920
  height: 1080
  fps: 60

base:
  light: "#FDFEFD"
  negative: "#020102"

palette:
  deepBlue: "#010540"
  cobalt: "#0017F7"
  electricBlue: "#006EFF"
  cyan: "#00FCFA"
  aqua: "#4DFFF7"
  magenta: "#FF00EB"
  violet: "#9C00FF"
  acid: "#B3FF03"
  white: "#FAFEFD"
  opBlack: "#010319"

pixel:
  baseGridPx: 4
  allowedGridPx: [4, 6, 8, 12]
  smoothing: false

composition:
  quietSpaceTarget: 0.78
  maxPrimaryForms: 1
  maxSecondaryInterferenceForms: 1
  sparseMarksOnly: true

motion:
  phaseCycleSec: 12
  warpPx: 14
  digitBouncePx: 28
  characterTravelXMaxPx: 55
  characterTravelYMaxPx: 16
  fullFrameShake: false
  bloom: false

glitch:
  durationMs: [80, 180]
  shiftPx: [8, 32]
  slicesMax: 3
  cooldownSec: 1.5
  fullScreenInvert: false
  persistentNoise: false

handoff:
  zeroHoldSec: 0.5
  lightToNegativeSec: 0.9
  keepCharacterPhase: true

protection:
  face: true
  subtitles: true
  evidence: true
```

---

# 18 · 最终验收标准

一张画面是否符合 PHASE / SIGNAL 2.0，使用以下五个问题快速判断：

1. **去掉所有文字说明，仅看轮廓与色块，还像倒计时/XOMK 那套画面吗？**
2. **画面里是否存在足够大的纯白或纯黑安静区域？**
3. **高密度欧普是否主要被限制在字形/明确遮罩内部？**
4. **是否只有少量 glitch 和校准痕迹，而不是整张“科技 UI”？**
5. **人物是否真正进入字形的前后空间，而不是站在一个矩形直播框旁边？**

只要第 2、3、5 项失败，通常就已经偏离核心风格。

---

# 19 · 给后续设计 Agent 的一句话执行摘要

> **不要设计一个赛博直播 UI。设计一张正在运动的实验像素欧普海报，然后把直播内容、L2D 和信息以最少的结构嵌入其中。以超大细长字形作为空间骨架，白/黑纯场作为基底，彩色像素和黑白欧普只在字形内部爆发；外围只留下少数印刷套准标记、微型等宽文字和短促 glitch scars。人物必须和字形前后穿插，而不是被放进传统 VTuber 面板。**
