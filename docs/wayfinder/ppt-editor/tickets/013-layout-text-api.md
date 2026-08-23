---
title: 公开带字符偏移的文本行盒
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./012-render-text-html-api.md
---

## Question

如何公开纯函数 `layoutText`，在保持当前原生 `<text>` 断行、CJK 挤压、分栏、行距与 autofit 结果不变的同时，为每个行盒补充 paragraph/run/字符偏移，支撑 Safari 编辑覆盖层的光标命中？

## Resolution

已公开纯函数 `layoutText(text, width, height, options)`，并把原生 SVG `<text>` 输出改为消费同一份
布局结果。公共行盒包含 `paragraphIndex / runIndex / columnIndex`、逻辑坐标、baseline、自然宽度与
CJK 挤压后宽度；每个正文分段携带 `TextRun.text` 的 UTF-16 半开区间和光标停靠点，可直接与
`DOM Range.offset` 对接。硬换行跳过换行符本身，代理对内部不产生停靠点，all-caps 的展开字符仍
映射回源字符；公式是只有首尾两个停靠点的原子分段，项目符号明确使用 `runIndex = -1`。

竖排不复制命中算法：行盒先在交换宽高后的逻辑空间生成，再返回与 SVG 旋转一致的仿射矩阵；
分栏、段前后距、行距、RTL、CJK 标点挤压与裸 `normAutofit` 均复用现有实现。艺术字公开未变形
行盒并标记 `unwarped`，静态预览继续走 `textPath`。宿主可注入 `measureText` 以使用自己的字体
度量服务；省略时沿用 Canvas + 确定性估宽，Worker / 无 DOM 环境仍可运行。默认生成字符停靠点，
只需行盒的渲染调用传 `includeCarets: false`，避免只读 SVG 路径承担逐字测量和分配。

为避免编辑能力继续堆进单一渲染文件，代码拆为 `text-layout`（断行与公共行盒）、`text-measure`
（Canvas 探测、回退估宽与公式缓存）、`text-layout-types`、`text-warp-presets` 和 `text-svg`
（纯 SVG 序列化）；最大新增布局文件 523 行，职责边界明确。`renderTextBodyToHtml` 与 SVG 调用共享
有效 autofit 比例，但两条出片文本路径仍保持独立。

验证覆盖全部固件中的 1163 个文本体、1492 个正文分段，并额外验证注入测量、最近光标命中、
UTF-16 代理对、`ß → SS`、RTL、硬换行、CJK 挤压、分栏、竖排、autofit、公式原子、确定性、
不修改输入和无 DOM 运行。`npm run check`、全量 `npm test` 与 `npm run build` 均通过：1987 项
core、42 项 edit-core、130 项图元文件断言，162 个快照与 194 对独立进程 SVG 指纹全部一致。

210 页 / 12810 元素基准中，默认带字符映射的行盒为 0.004ms/次；只读路径零编辑状态，编辑常驻
内存增量 +0.9%，脏元素渲染 0.012ms/次、DOM 替换 0.086ms/次。core 构建产物 88.21KB gzip；
npm dry-run 为 56 个文件、191592 字节，ESM 与声明均确认公开新 API。

浏览器模式仍用 `renderTextBodyToHtml` 的 contenteditable 覆盖层；Safari 运行时探测中招时由后续
编辑器适配层切换 engine 模式，并把本 API 的 `transform` 同时用于行盒与命中点。core 不负责焦点、
IME 或 DOM 生命周期，这条边界避免把浏览器状态带入纯数据/Worker 层。
