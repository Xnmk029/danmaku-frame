# 今日测试模型标记

制作台「今日测试模型 ID」沿用原来的 `broadcast.model` 字段，每个 A / B / C 布局独立保存。输入完整模型 ID 后，自动匹配本地图标并提取版本；点击「保存并应用当前布局」后，前景和后景同步更新。无需增加 API 或重启中继服务。

例如 `Astra Opus5.5` → Claude 图标 + 长体 `5.5`，`DeepSeek V3.2` → DeepSeek 图标 + `3.2`。常见模型系列有别名匹配，其他图标可使用图谱中的名称 / ID 作为模型 ID 前缀。不能匹配时使用通用校准标记，保留原文；没有版本时不显示装饰数字，也不回退到无意义的 O / 8。多位版本会收缩宽度以适应同一区域。

视觉布局：A / C 恢复原字形高低错落的骨架，版本数字使用圆角单线 Path2D，保留人物前后的局部穿插。B 也采用右侧窄区内的高低交错长体数字。图标与完整 ID 分开摆放，形成对角关系；不再用同轴图标 / ID 堆叠。图标保持原始比例。数字沿用页面动态像素欧普材质、主题与低刺激模式，白色蒙版保留材质原本强度；图标使用提供图谱的静态信号蓝 SVG。

模型数字、图标绘制在 Canvas 后景，ID 注记与局部穿插绘制在前景，因此 PNG / WebM 合成导出包含它们，分层组合不会重复显示。更换静态代码后，需要刷新制作台及 OBS 前景 / 后景源一次；之后模型变更通过已有配置轮询更新。

导入资产来自用户指定的 `phase-mark-complete.zip`：`exports/scaled/240/signal/`，共 340 个 SVG。仅导入运行时所需文件、名称目录、来源说明和 MIT 许可；原始 ZIP 不复制入项目。来源提交及目录见 `public/frame/assets/model-marks/catalog.json`，许可见同目录 `UPSTREAM-LICENSE`。上游 LobeHub/lobe-icons 的商标和名称保留。

复现导入：

```powershell
python scripts/import-phase-model-icons.py 'I:\remotion\projects\channel-style-lab\phase-signal-ai-icons-v01\exports\phase-mark-complete.zip'
```

验证：`node --test tests/model-mark.test.mjs`、`node scripts/verify/verify-model-mark.cjs`。后者验证 A/B/C、720p、前后景配置同步、空白与未识别模型，并输出 `tmp/qa/model-mark-*.png`。

收尾排版：三套布局的交错版本字高度缩短约 20%，保持细长比例并向下收拢；A 弹幕区 162→282px，B 166→256px。图标移到弹幕下方，与 ID 侧注保持错位。弹幕保留两行截断，取消会提前裁掉第二行的固定高度。C 的弹幕区保留独立右栏。

A 制作台的示例人物展示框相应下移到 y=430，避免扩展后的弹幕盖住人物面部；OBS 独立人物源的位置由场景自行管理。
