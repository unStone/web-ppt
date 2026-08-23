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

## Not yet specified

- M2 的 DOM 增量更新边界需要在 M0 的稳定元素身份和 M1 的命令事件形状落定后细化。
- M3 的文本 API 已固定；浏览器 contenteditable、Safari engine、扁平格式区间与 IME 事务仍要等 M2 的编辑器生命周期和选择事件形状落定后拆票。
- M4 的新增页、图片、形状和表格要在 OPC 关系与有序 XML 插入能力完成后拆成独立任务。
- M5 的自动保存、崩溃恢复、选择窗格、格式刷和全量性能预算要根据真实 patch 体积与事件模型拆分。
- React、Vue、Web Component 或其它框架适配的最终包形态，要在 `@web-ppt/editor` 的生命周期和订阅 API 稳定后，用最小示例与包体积实测决定；框架运行时不得进入 `core`、`edit-core` 或基础 DOM 包。
- M6 的动画编辑、顶点编辑、表样式与协同适配分别形成独立扩展，只有主编辑闭环稳定后才展开。

## Out of scope

- `.ppt` 二进制写回：编辑时明确转换并生成 `.pptx`，避免把 OOXML 才有的能力静默降级。
- 图表数据、SmartArt 内部、OLE/墨迹/媒体内部编辑：首个完整版本只支持框架级变换、层级与删除。
- 宏逻辑、审阅批注工作流、真实三维、模板市场与 AI 生成：不属于本编辑引擎目标。
- 服务端转换或文件上传：与纯浏览器、文件不出本机的产品边界冲突。
