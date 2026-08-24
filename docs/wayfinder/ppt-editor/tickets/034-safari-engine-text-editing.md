---
title: 让 Safari engine 行盒驱动文字编辑面
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./033-rich-text-clipboard.md
---

## Question

如何让 `SlideEditorOptions.textMode: 'svg'`（以及运行时探测命中的 `auto`）不仅把静态层切到原生 SVG 文字，
还让 SVG 外的 `contenteditable` 覆盖层严格消费 core `layoutText()` 的行盒，从而在受 WebKit 23113 影响的
Safari/iOS 上进入编辑、输入、提交和退出都不重新断行？

当前静态层已经能按 `textMode` 选择 HTML 或 SVG，编辑覆盖层却始终调用浏览器自动换行的
`renderTextBodyToHtml()`。本票把“文本模式”提升为同一视图生命周期内的统一排版决策：`html` 继续使用现有
browser 行盒且输出必须保持兼容；`svg` 使用 engine 行盒。`auto` 只消费既有能力探测结果，禁止 UA 判断。

core 的公开纯函数 seam 仍是 `layoutText()` 与 `renderTextBodyToHtml()`。engine HTML 必须直接使用
`layoutText()` 返回的行、分段、UTF-16 范围、RTL 物理坐标、竖排变换、分栏、CJK 标点挤压和有效 autofit
比例；每条视觉行绝对定位并 `white-space: pre`，不得让浏览器再次断行。新增选项必须是纯数据、Worker 安全，
默认 browser 输出逐字节不变，不能把 DOM 或 Safari 判断放进 core。

engine DOM 仍是唯一可见且真实可编辑的输入面。软换行只改变视觉行盒，不进入模型；`a:br` 必须作为语义硬换行
保留在 DOM 顺序中。一个 run 可跨多个视觉行，因此每个可见分段要携带同一 `data-r` 与自己的源半开区间；空 run、
被断行器丢弃的行首空格、项目符号和公式原子也必须有不污染视觉的语义锚点。`TextPos ↔ DOM Range` 要在重复
`data-r`、软换行边界、代理项、RTL、竖排、空段和公式两侧保持双向一致，不能退回 `getClientRects()` 猜索引。

发布挂载 seam 验证 `openEditor(...).mount({ textMode: 'svg' })`：双击进入后 engine 行盒坐标与同一文本体的
`layoutText()` 一致；真实 `beforeinput`、Range 选区、字符/段落格式、富文本粘贴、IME 生命周期、撤销重做与多视图
继续走既有模型事务。`textMode: 'html'` 必须保持现有 DOM 排版；view 模式不创建编辑面，另一视图不能接管活动选区。

确定性固件覆盖刚好会产生 browser/engine 断行差异的中英日混排、CJK 标点挤压、多 run 跨行、硬换行、空 run/
空段、RTL、竖排、分栏、公式和裸 `normAutofit`。保存后 core 重开逐字符与格式相等，HTML/SVG 两条预览指纹
等于有效投影，LibreOffice 打开不得修复。真实 Chrome 用显式 engine 模式验证 2,000 字符输入到完整上屏 p95
不超过 30ms；能力探测分支另以公开挂载行为验证，不能把“Chrome 能跑”冒充 Safari 特判正确。

本票不实现 autofit 的 100ms 输入节流、`spAutoFit` 改形状高度、表格单元格编辑、Safari 自带输入法真机矩阵、
EditContext、产品工具栏或框架适配包。它们后续只能消费本票固定的行盒/Range seam，不另建 Safari DOM 分支。

## Resolution

根因不是 Safari 的输入事件，而是同一视图做了两次互不相干的排版决策：静态层在探测失败后使用
`layoutText()` 驱动的原生 `<text>`，SVG 外的 `contenteditable` 却仍交给 CSS 自动断行。现在
`renderTextBodyToHtml(..., { layout: 'engine' })` 直接序列化公开行盒；每条视觉行与 run 分段绝对定位、
`white-space: pre`，可见分段携带源 UTF-16 半开区间，不可见语义锚点保留硬换行、被丢弃空格、空 run/
空段和公式原子。默认/显式 `browser` 输出逐字节相同，core 仍无 DOM 且 Worker 可运行。

`@web-ppt/editor` 把解析后的视图 `textMode` 作为一次性排版决策传给文字控制器：`html` 维持 browser
行盒，显式 `svg` 与 `auto` 能力探测降级都使用 engine 行盒。`TextPos → DOM Range` 会在重复
`data-r` 中按 `data-from/to` 选择正确视觉分段，软换行边界优先下一行、run 尾停靠前一段；反向映射仍
只读取 DOM 顺序，不用几何猜索引。契约覆盖多 run 跨行、CJK、硬换行、空 run/段、代理项、RTL、竖排、
分栏、项目符号、公式与裸 autofit，并验证段落格式、输入、撤销和保存重开。

验证证据：

- 确定性固件双次生成的 40 文件聚合 SHA-256 均为
  `334e4b1741624f598970c811216f1bb1cf536e14bc80ca397bccc1e99fe91aaf`；只新增该页的 HTML/SVG 两个
  快照，既有 162 个基线未改变。
- 真实 Chrome 的 engine 行盒最大偏差为 0.009px，2,000 字符输入到强制完整布局的多轮 p95 为
  8.3–17.8ms，最慢仍低于 30ms 预算；隔离 iframe 证明 `auto` 能力探测会同时降级静态预览与编辑面，DevTools 输入域产生的
  `isTrusted beforeinput` 和 IME 组词在跨行重复分段中通过，组词期间节点身份稳定。
- `engine-text-editing.pptx` 只改 `ppt/slides/slide1.xml`，core 重开保留全部文字语义，HTML/SVG 指纹
  等于有效投影；LibreOffice 无修复打开并导出 119645-byte PDF。
- 双轴审查最终 Standards/Spec 均为 0 finding。`npm run check && npm test && npm run build` 顺序全绿：
  2037 core 与 164 快照、403 edit-core、36 保存、195 editor、40 份固件/135 页/270 对独立进程指纹、
  130 metafile，五个发布包全部构建；editor 入口为 27.46KB gzip，五包 `npm pack --dry-run` 均通过。

后续仍按票据边界独立处理 autofit 输入节流与 `spAutoFit` 改高、表格单元格编辑、Safari 真机输入法矩阵、
EditContext 和框架适配包；这些能力只能消费本票固定的行盒/Range seam，不再建立浏览器专用编辑 DOM。
