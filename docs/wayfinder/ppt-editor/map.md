---
title: 纯 Web PPT 编辑能力
status: open
labels:
  - wayfinder:map
tracker: local-markdown
---

## Destination

依据 [编辑能力技术方案](../../editing-design.md)，把当前只读引擎演进为稳定、易用的纯 Web PPT 编辑器：真实 `.pptx` 可打开、编辑、撤销、保存并保持未编辑内容；查看与编辑共用现有高保真预览链路；核心能力以无框架发布包交付，并为 React、Vue 等生态提供低成本适配面。

完成不是“画布上能拖动”，而是 M0–M4 的用户闭环、M5 的可恢复与性能打磨均通过自动验收；M6 的动画、顶点、表样式与协同以独立扩展验证，不污染单机主包。

## Notes

- 领域词汇见 [CONTEXT.md](../../../CONTEXT.md)，架构与验收以 [编辑能力技术方案](../../editing-design.md) 为准。
- 必须遵守根目录 `AGENTS.md`：`render/` 只依赖 `types.ts`、格式按魔数识别、两条出片文本路径不合并、`core` 与 `edit-core` 不依赖 DOM。
- 每个任务完成后必须运行 `npm run check && npm test && npm run build`；新增能力必须有确定性固件，写回保真还要做独立进程渲染对比与 LibreOffice ground truth。
- 性能是接口契约：只读路径零额外负担；拖动帧 ≤ 8ms、单元素提交 ≤ 16ms、200 页/50MB 且只改 3 页的保存 ≤ 500ms、编辑内存增量 ≤ 40%。
- 本地 Markdown 任务以 `tickets/*.md` 表示子任务；`status: open` 且 `blocked_by: []` 的任务位于前沿，开始工作前先把 `assignee` 改为当前执行者。
- 本地图按 `wayfinder` 推进：一轮最多关闭一个任务；答案、验证证据与后续发现记录在该任务的 `## Resolution`，地图只追加一句决策索引。

## Decisions so far

<!-- 已关闭任务的一句话索引；详细答案只留在对应任务。 -->

- [建立确定性渲染身份](tickets/001-deterministic-render-identity.md) — 默认全局唯一语义保持不变，显式安全前缀启用单次渲染局部计数，使编辑投影可逐字节稳定比较。
- [保留可编辑解析溯源与原包生命周期](tickets/002-editable-parse-provenance.md) — `edit` 与 `keepPackage` 独立按需开启，以零拷贝原包和 OOXML 锚点支撑写回，同时让默认预览路径保持零额外状态。
- [让预设几何在编辑投影中可重算](tickets/003-editable-geometry.md) — 两种输入在 edit 模式统一保留 `preset + adj`，公共纯函数按当前尺寸重算路径，默认预览与自定义几何语义不变。
- [建立 EditDoc 与有效投影](tickets/004-edit-doc-projection.md) — 独立无 DOM 包以稳定身份、`src/ovr`、协同安全分数序和 WeakMap 精确缓存投影回既有 Slide，框架对象在模型边界降权且 210 页性能远低于预算。
- [证明 M0 编辑投影与只读渲染等价](tickets/005-prove-m0-equivalence.md) — 22 份固件的两条文本路径以 194 对独立进程原始 SVG 指纹证明投影等价，210 页门禁同时守住默认零状态、+0.6% 内存与 0.418ms 提交重渲。
- [公开元素级增量 SVG 渲染](tickets/011-render-element-api.md) — core 以同一渲染分派返回可独立替换的 markup/defs，稳定元素命名空间守住逐字节等价，真实脏元素 DOM 提交为 0.091ms/次。
- [公开共用 HTML 文本渲染](tickets/012-render-text-html-api.md) — 预览与编辑覆盖层共用无 DOM 的 XHTML 生成器，1163 个真实文本体身份完整，HTML 上屏 0.143ms/次且 Safari 不在 foreignObject 内编辑。
- [公开带字符偏移的文本行盒](tickets/013-layout-text-api.md) — 原生 SVG 与公开纯函数共用行盒，UTF-16 光标映射覆盖 RTL/CJK/分栏/竖排/autofit/公式，默认映射仅 0.004ms/次。
- [实现保留型 XML 树](tickets/006-preserving-xml-tree.md) — 保存期按需入口以最小词法改写、命名空间展开名和兼容分支感知的统一 sequence 插入守住 OOXML 写回边界，默认编辑包零增重。
- [实现 ZIP 原始条目直通保存](tickets/007-zip-passthrough.md) — 保存期 OPC 入口以完整本地记录直通、可解释重压、连续包刷新与可释放生命周期守住 50MB 写回，三页完整保存 84.0ms。
- [建立命令、事务与双向 Patch 历史](tickets/008-command-patch-history.md) — 无 DOM Editor 以纯数据命令、影响集不变量、选择恢复与远端路径 rebase 建立原子撤销内核，210 页撤销重渲约 0.5ms/次。
- [把 SetXfrm 精确补丁写回 OOXML](tickets/009-set-xfrm-ooxml-patch.md) — 以命名空间感知的 spid 宿主定位、可克隆基线重建和包所有权刷新，实现形状、组、frame 与 p14 墨迹的可撤销增量保存。
- [建立编辑会话与三层静态视图](tickets/014-editor-session-static-view.md) — 可发布的无框架会话统一资源所有权，以稳定身份、精确 markup/defs 分区和真实批量回退复用高保真预览，真实 Chrome 单元素提交 p95 为 0.100ms。
- [实现原生 SVG 点选与组进入](tickets/015-native-hit-selection.md) — 单视图监听器把浏览器命中统一提交到 headless 选区，守住组进退、Alt z 序、view 无副作用与静态 DOM 身份，真实 Chrome 点选反馈 p95 为 0.100ms。
- [统一画布坐标并绘制选择框手柄](tickets/016-selection-space-handles.md) — 纯仿射矩阵与 core 组变换严格对偶，单选 OBB、多选 AABB 和 9 个屏幕恒尺寸控件均只更新交互层，真实 Chrome 三档缩放最大偏差 0.000px、完整上屏 p95 0.100ms。
- [建立移动手势与拖动幽灵](tickets/017-drag-move-gesture.md) — 3px 阈值后的主指针由视图捕获，单选/多选和嵌套组每帧只平移私有幽灵，松手形成一个可撤销写回事务；真实 Chrome rAF p95 0.100ms。
- [绑定缩放手柄并提交尺寸](tickets/018-resize-handle-gesture.md) — 8 柄以共享 pointer capture/rAF 状态机完成旋转嵌套、多选、Shift/Alt 和过锚翻面，真实 Chrome 三档 zoom 最大误差 0.009px；普通/60×45° 近奇异帧 p95 为 0.100/0.600ms。
- [绑定旋转柄并提交角度](tickets/019-rotation-handle-gesture.md) — 单选父空间与多选共同中心共用连续角状态机，父矩阵手性守住奇数祖先翻转，真实 Chrome 三档 zoom 嵌套/多选最大偏差 0.000/0.009px，60 元素帧 p95 0.300ms。
- [实现移动吸附与智能参考线](tickets/020-drag-snapping-guides.md) — 无 DOM 线性求解器以屏幕 6px、稳定优先级和同组世界 AABB 驱动固定交互层参考线，真实 Chrome 三类误差均为 0.000px，含布局的 60 元素帧 p95 0.200ms。
- [实现 PowerPoint 语义框选](tickets/021-marquee-selection.md) — 空白手势越过屏幕 3px 后才快照当前组直属候选，以世界 OBB 四角完全包含驱动 interaction SVG；Chrome 误差 0.000px，60 元素首帧/p95 0.900/0.200ms。
- [实现方向键微移与连续撤销](tickets/022-keyboard-nudge.md) — 每个视图以物理按键 token 驱动 1/10px 世界位移，历史按路径压缩长按 patch；Chrome 三档 zoom 最大偏差 0.049px，60 元素连续 repeat p95 1.800ms。
- [实现 Tab 元素遍历与焦点所有权](tickets/023-tab-selection-order.md) — 当前页或已进入组以直属绘制顺序双向循环，事件视图隔离跨页共享选区；Chrome 60 元素完整反馈 p95 0.200ms，可信 Tab 焦点不外逃。
- [实现修饰键点选与框选增减选](tickets/024-modifier-multiselect.md) — Shift/Ctrl/Meta 以当前页或组直属绘制顺序做对称差，Alt 可穿透增减；Chrome 60 元素点选/框选 p95 0.700/0.400ms，可信三种修饰键均通过。
- [接通撤销重做快捷键与跨页回显](tickets/025-history-shortcuts.md) — Ctrl/Cmd+Z/Y/Shift+Z 直连 headless 历史并只让事件视图回显结果页；Chrome 60 元素撤销/重做 p95 1.200/1.100ms，可信 Ctrl/Meta 通过。
- [实现元素删除与占位符两段式清空](tickets/026-element-delete.md) — RemoveElement 以稳定 z 序双向结构 patch 和最小 OOXML 写回接通 Delete/Backspace；未触碰兄弟保持 DOM 身份，Chrome 60 元素删除/撤销/重做 p95 3.4/1.5/0.9ms。
- [实现元素层级调整与快捷键](tickets/027-element-layer-order.md) — SetZ 以链表终态规划、Fenwick 最小稀疏序和固定槽位接通四向层级、增量 DOM 与最小 OOXML 重排；Chrome 60 元素层级/撤销/重做 p95 1.3/0.3/0.2ms。
- [实现元素视觉对齐](tickets/028-element-alignment.md) — AlignElements 以世界 AABB 和父空间逆变换统一六向对齐、原子历史、增量 DOM 与最小写回；Chrome 60/60 完整反馈 p95 1.5ms。
- [实现元素复制剪切粘贴](tickets/029-element-clipboard.md) — 版本化纯 JSON 载荷以完整 OOXML/关系/资源物化接通跨页跨实例复制、可信剪贴板、原子历史与保存；Chrome 60 根完整反馈 p95 8.0ms。
- [实现基础文本输入与 IME 闭环](tickets/030-basic-text-editing.md) — 扁平 mark 模型、Range 锚定 IME 与保留型段落写回贯通输入到保存；动态字段/公式/RTL 保真，Chrome 可信输入 p95 0.400ms。
- [实现文字字符格式编辑闭环](tickets/031-run-formatting.md) — `SetRunProps`、三态查询、Range/IME 与最小 OOXML 覆盖写回统一字符格式；公开工具栏 seam 可供任意 UI 框架直接消费。
- [实现文字段落格式编辑闭环](tickets/032-paragraph-formatting.md) — `SetParaProps` 以继承感知稀疏覆盖统一六个段落属性、DOM Range、多视图与最小 `pPr` 写回；Chrome 完整提交 p95 0.4ms。
- [实现文字剪贴板与富文本粘贴闭环](tickets/033-rich-text-clipboard.md) — 纯 JSON 富文本片段、清洗 HTML 与同步剪贴板事件统一 copy/cut/paste、纯文本快捷键和最小写回；Chrome 2,000 字符完整上屏 p95 5.6ms。
- [让 Safari engine 行盒驱动文字编辑面](tickets/034-safari-engine-text-editing.md) — `textMode` 现在统一静态 SVG 与 SVG 外编辑面的排版决策，源 UTF-16 分段守住复杂文本 Range；Chrome 2,000 字符完整上屏最慢 p95 17.8ms、行盒偏差 0.009px。
- [实现表格单元格文字编辑闭环](tickets/035-table-cell-text-editing.md) — 稀疏单元格覆盖复用既有文字模型与保留型写回，browser/engine 共用编辑面；Chrome 20×10 表格上屏 p95 0.500ms。
- [节流 normAutofit 文字输入重排](tickets/036-throttle-normal-autofit-text-input.md) — 同步模型提交与视图派生比例分离，持续输入最多每 100ms 以实际内容盒重排；Chrome 三路 p95 最慢 3.500ms。
- [让 spAutoFit 文字形状随内容改高](tickets/037-grow-sp-autofit-text-shapes.md) — 共享行盒求解器与 entry 级因果历史让文字提交原子改高并保持局部锚点；Chrome browser/engine p95 4.2/4.1ms，LibreOffice 几何偏差小于 0.1px。
- [实现文字框属性编辑闭环](tickets/038-edit-text-body-properties.md) — 继承感知的 `SetBodyProps`、选区 seam 与保留型 bodyPr 写回统一八类属性和三种 autofit；Chrome browser/engine p95 1.4/0.7ms，LibreOffice 分栏/方向 oracle 通过。
- [让表格末格 Tab 追加可编辑行](tickets/039-append-table-row-on-tab.md) — 稳定 rowId、稀疏投影与保留型 `a:tr` 写回贯通并发安全的追加/输入/撤销/保存；Chrome 20×10 完整上屏 p95 9.500ms，LibreOffice 几何 oracle 通过。
- [新增可立即编辑的预设形状](tickets/040-add-preset-shape.md) — 主题求值与写回共用默认源，part 级 spid 和有序 `p:spTree` 插入接通 AddShape、交互、历史与保留型保存；Chrome 60 元素 p95 0.500ms，LibreOffice 圆角轮廓 oracle 通过。
- [按现有版式新增可立即编辑的页面](tickets/041-add-slide-from-layout.md) — edit-only 版式目录与原子 SlideTreePatch 接通新增页、占位符输入、动态页码/跳页、撤销重做和最小 OPC 保存；Chrome 21 页 p95 3.3ms，LibreOffice oracle 通过。
- [插入可预览可保存的图片](tickets/042-add-image.md) — SHA-256 文档级媒体闭包与原子 AddImage 接通文件选择、图片占位符、粘贴、变换、撤销和最小保存；Chrome 60 元素 p95 0.500ms，LibreOffice 像素 oracle 通过。
- [插入可立即编辑的主题表格](tickets/043-add-table.md) — 主题求值与自包含直接格式接通原生 AddTable、逐格输入、Tab 追加、跨文档复制和最小保存；Chrome 20×10 p95 6.8ms，LibreOffice 网格 oracle 通过。
- [用稳定页身份重排页面](tickets/044-move-slide.md) — 稳定 SlideId 锚点与专用 SlideOrderPatch 接通页序、动态字段、多视图、历史和最小保存；Chrome 200 页 p95 2.2ms，LibreOffice 无修复打开。
- [删除页面并完整清理其 OPC 身份](tickets/045-remove-slide.md) — 可逆页面树快照与精确 OPC 删除闭包接通 fallback、多视图、历史和共享资源保留；Chrome 200→1 页 p95 2.4ms，LibreOffice 页序与 notes 一致。
- [复制页面并重建独立 OPC 身份](tickets/046-duplicate-slide.md) — 稳定页面树副本与 baseline 驱动的独立 slide/notes 闭包接通多视图、历史、section 和最小保存；Chrome 性能预算与 LibreOffice oracle 均通过。
- [编辑形状的矢量填充与描边](tickets/047-shape-fill-stroke.md) — 规范化直接格式命令与查询 seam 接通矢量填充、形状/图片描边、多视图、历史和保留型保存；Chrome 预算与 LibreOffice 线宽/虚线/端点 oracle 均通过。
- [编辑形状与图片的二维效果](tickets/048-shape-effects.md) — `SetEffects` 以直接空列表/恢复来源的双语义接通形状、图片和组的四类效果、增量多视图与保留型保存；四项 Chrome 独立预算及 LibreOffice 像素/重存 oracle 均通过。
- [替换并裁剪图片内容](tickets/049-replace-crop-image.md) — `ReplaceImage`、`SetCrop` 与双矩形手势接通文件替换、来源裁剪、历史资源回收、共享媒体闭包和最小保存；Chrome 60 图片提交/帧 p95 0.5/0.1ms，LibreOffice 非对称像素 oracle 通过。
- [编辑元素与文字超链接](tickets/050-edit-hyperlinks.md) — 稳定页身份与安全外链贯通命令、查询、复制、最小保存及 edit/view/Viewer 键盘路由；Chrome 预算和 27 份 LibreOffice 工件通过。
- [编辑页面矢量背景与隐藏状态](tickets/051-edit-slide-background-hidden.md) — 稳定页身份与来源恢复语义贯通背景/隐藏命令、查询、多视图、历史和保留型保存；Chrome 200 页预算及 28 份 LibreOffice 工件通过。
- [上传并裁剪页面图片背景](tickets/052-slide-image-background.md) — 内容寻址媒体闭包与页面级来源物化贯通图片背景上传/裁剪、多视图、历史和保留型 `blipFill` 写回；Chrome 200 页预算及 30 份 LibreOffice 工件通过。
- [为既有页面切换版式并保持内容](tickets/053-change-slide-layout.md) — 稀疏 `SetLayout` 与继承感知占位符重绑贯通多视图、历史和最小 slideLayout 关系写回；Chrome 200 页完整上屏及 31 份 LibreOffice 工件通过。
- [编辑并保存演讲者备注](tickets/054-edit-speaker-notes.md) — `SetNotes` 与来源感知查询贯通精确段落、共享身份分叉、新旧页面、复制页、零画布重绘和最小 OPC 闭包；异构格式、空行、图片及未知扩展保留，Chrome 2,000 字符提交 p95 0.100ms，32 份 LibreOffice 工件通过。
- [发布 React 与 Vue 查看编辑适配包](tickets/055-publish-react-vue-adapters.md) — 单一框架无关 adapter 统一受控 view/edit、文件与外部会话所有权、错误及销毁；React/Vue SSR 和真实浏览器全生命周期通过，两包仅 0.92/1.16KB gzip。
- [建立可持久化操作日志与确定性恢复原语](tickets/056-recovery-journal-primitives.md) — 版本化纯 JSON 帧、资源闭包、实际 OPC 身份下界与原子 staged replay 贯通 headless 恢复；1,000 帧回放 269.9ms，两路最终审查归零。
- [持久化恢复日志并提供恢复决策](tickets/057-persist-recovery-journal.md) — 完整源指纹、异步 IndexedDB 分块、原子代际换代与统一 adapter 恢复状态贯通崩溃恢复；1,000 帧写入/重开均低于预算，两路最终审查归零。
- [实现可访问的选择窗格与对象锁定](tickets/058-accessible-selection-pane.md) — 稳定投影目录、稀疏名称写回与纯会话锁定/隐藏贯通唯一 DOM 控制器及 React/Vue 薄挂载；Chrome 60 元素往返 p95 0.4ms，LibreOffice 实件打开通过。
- [实现可连续使用的格式刷](tickets/059-continuous-format-painter.md) — 严格 `ApplyFormat` 与会话级单次/连续状态机贯通对象、文字、表格、跨页和多视图，React/Vue 共享同一 adapter；Chrome 60 元素完整反馈 p95 0.300ms，最小保存与 LibreOffice 实件打开通过。
- [实现文档级查找替换闭环](tickets/060-document-find-replace.md) — 严格 `findText` / `ReplaceText` 与会话级增量索引贯通可见文字、精确范围高亮、跨页导航、原子历史、保存恢复及 React/Vue adapter；Chrome 200 页和 60 元素预算、LibreOffice 实件及两路最终审查全部通过。
- [编辑并即时预览页面切换效果](tickets/061-edit-slide-transitions.md) — 统一 `Slide.transition` 与无框架 adapter 贯通 40 种效果、严格命令、view/edit 预览、保留型 OOXML 及 React/Vue；Chrome 复杂页与 200 页预算、LibreOffice 实件通过。
- [编辑并预览元素动画时间线](tickets/062-edit-element-animations.md) — 稳定元素身份与统一播放层贯通安全动画目录、view/edit 草稿预览、保留型 OOXML 和 React/Vue；128 步回读边界、Chrome 预算、LibreOffice、双审及 npm beta 发布通过。
- [官网独立接入可保存编辑器页面](tickets/063-integrate-site-editor-page.md) — 独立 `editor.html` 以已发布无框架 seam 接通本地打开、编辑、预览与保存；响应式、复杂页滚动、`.ppt` 安全降级及 GitHub Pages 子路径均经真实浏览器验证。
- [实现生成式 PPTX 保存](tickets/064-generated-pptx-save.md) — 无原包 EditDoc 可确定性生成完整 PPTX，补丁保存路径与按需体积边界保持独立。
- [打通 .ppt 编辑另存 .pptx 的产品闭环](tickets/065-ppt-edit-save-as-pptx.md) — 首次编辑确认、统一 adapter 格式 seam 与诚实 frame 降级贯通真实浏览器下载及 LibreOffice 无修复打开。
- [建立空白新建文稿闭环](tickets/066-blank-document-entry.md) — 按需确定性模板、三种真实版式与官网新建/加页入口贯通插入、历史、动态页码、保存重开及 LibreOffice 无修复打开。
- [实现元素组合与解组](tickets/067-group-ungroup-commands.md) — 原子层级 Patch 与仿射分解贯通稳定身份、最小写回、多视图快捷键及来源语义；Chrome 60 元素组合/解组 p95 6.9/7.1ms，LibreOffice 几何 oracle 与两路终审通过。
- [补全官网编辑页工具栏能力面](tickets/073-site-editor-toolbar-completion.md) — 公开 seam 已接入上下文工具栏、响应式抽屉与确定性本机恢复，真实 Chrome 的操作、撤销重做、保存重开、双尺寸布局和零 console warning 契约全部通过。
- [实现文本列表升降级](tickets/068-text-list-level.md) — 九级继承重基、自动续号、Tab 交互、稀疏保存和双渲染路径已贯通，LibreOffice 几何 oracle、批量负载预算与两路终审全部通过。
- [盘点并补齐附录 B 快捷键](tickets/069-appendix-b-shortcut-audit.md) — 统一文档键盘通道贯通全选、逐 run 字号、对齐、新建与翻页，产品职责、IME 边界、受控切页和真实 Chrome 可信输入均已闭环。
- [让浏览器性能契约抗环境负载](tickets/074-perf-contract-load-isolation.md) — 功能断言与性能预算延迟汇总彻底分离，测前/测中环境基线仅授予一次全新 Chrome 重测；真实并行 CPU/Chromium 负载、安静输出与双轴终审全部通过。
- [建立顶点编辑独立扩展](tickets/070-vertex-editing-extension.md) — 稳定自由形状地址、按需圆弧物化与保留型保存贯通独立 vertex 入口；Chrome 60 元素拖动 p95 0.2ms，主入口零增长且 LibreOffice 像素 oracle 通过。
- [实现表格样式应用与写回](tickets/071-table-style-library.md) — 公开样式目录、六开关命令、直接格式优先级与按需 OPC 物化贯通补丁及生成保存，LibreOffice 表样式 oracle 与两路终审通过。
- [建立协同适配扩展包](tickets/072-collab-adapter-package.md) — 字段级 LWW、严格同副本因果前缀与精确身份分区贯通可插拔 provider、恢复和双标签页，薄包 12160B gzip 且两路终审归零。

## Not yet specified

- 2026-08-28 重规划：剩余工作已全部拆为票据 064–075——[生成式保存](tickets/064-generated-pptx-save.md)
  →（[.ppt 转存](tickets/065-ppt-edit-save-as-pptx.md)、[空白新建](tickets/066-blank-document-entry.md)）、
  [组合解组](tickets/067-group-ungroup-commands.md)、[列表升降级](tickets/068-text-list-level.md)、
  [快捷键对账](tickets/069-appendix-b-shortcut-audit.md)、[顶点](tickets/070-vertex-editing-extension.md) /
  [表样式](tickets/071-table-style-library.md) / [协同](tickets/072-collab-adapter-package.md) 三个 M6 扩展、
  [编辑页工具栏](tickets/073-site-editor-toolbar-completion.md)、[性能契约抗负载](tickets/074-perf-contract-load-isolation.md)、
  [0.5.0 转正](tickets/075-0.5.0-stable-release.md)。建议顺序：064 与 010（等外部 Windows runner）先行，
  067 / 073 次之，070–072 独立推进，075 收尾。§10.3 性能预算已在各票据内逐项达标，不再单列。
- [072](tickets/072-collab-adapter-package.md) 的 CRDT / LWW 选型在票据内决策；0.6 线目标待 0.5.0 转正后另立。
- 不把产品 UI 或业务状态塞入无框架 adapter（073 只做 seam 接线）。

## Out of scope

- `.ppt` 二进制写回：编辑时明确转换并生成 `.pptx`，避免把 OOXML 才有的能力静默降级。
- 图表数据、SmartArt 内部、OLE/墨迹/媒体内部编辑：首个完整版本只支持框架级变换、层级与删除。
- 宏逻辑、审阅批注工作流、真实三维、模板市场与 AI 生成：不属于本编辑引擎目标。
- 服务端转换或文件上传：与纯浏览器、文件不出本机的产品边界冲突。
