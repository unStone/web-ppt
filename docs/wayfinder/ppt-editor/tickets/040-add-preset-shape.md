---
title: 新增可立即编辑的预设形状
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./029-element-clipboard.md
  - ./030-basic-text-editing.md
---

## Question

如何让任意 UI 框架通过公开纯数据命令
`AddShape{ slideId, preset, rect }` 在现有幻灯片顶层新增一个预设形状，并让它在同一次提交后立即可见、
被选中、可拖拽缩放、可双击输入文字，随后能撤销、重做、保存和重开，而不是由某个工具栏直接拼 DOM
或绕过 `EditDoc` 修改 XML？

本票只接受已知的 DrawingML 预设名和有限正尺寸；`slideId` 必须指向带可写 OOXML part 的现有页面。
命令为新元素分配会话稳定 `ElementId`、目标 slide part 内唯一的 `cNvPr@id` 和兄弟末尾分数序；
生成的 `ShapeElement`、`GeomSpec`、空文字输入模板与 OOXML 宿主必须表达同一份状态。一次命令只产生一个
`ElementTreePatch`，历史和增量投影为 O(1)，失败时元素身份计数、选区和文档均原子回滚。

新形状必须复用现有元素插入主干：`ElementTreePatch → effective projection → DOM 分区 →
ElementInsertionSource → baseline save`。保存期生成符合 ECMA-376 sequence 的 `p:sp`：完整
`p:nvSpPr`、`p:spPr/a:xfrm/a:prstGeom/a:avLst`、可见默认填充和描边，以及可接续现有文字编辑器的空
`p:txBody`。坐标按 px→EMU 转换，名称和 spid 确定；未知 XML、命名空间、其它元素和其它 ZIP part
不得变化。连续保存必须从基线重建，不能重复插入。

`Editor.exec(AddShape)` 默认选中新根；显式事务选区仍优先。`@web-ppt/editor` 的既有订阅和挂载视图要在
同一帧创建静态 SVG 分区和选择框，不要求 React/Vue 运行时，也不新增框架专属命令。view 模式没有
编辑命令入口，保持零变更。公开类型和 README 给出工具栏调用示例，后续 React/Vue/Web Component
适配只需调用同一 `session.editor.exec` seam。

确定性固件覆盖普通页、含未知 `p:spTree` 兄弟的保留页、自定义主题页、60 元素性能页，以及至少六种
几何类别（矩形、圆、箭头、星形、流程图、开放连接线）。Node 先验证命令纯度、非法输入、投影、选区、
历史、连续新增、保存重开和只改目标 slide XML；两条预览路径在独立进程中验证保存前后等价。真实
Chrome 验证 headless 调用后的静态层、交互层、拖拽和双击输入继续工作，60 元素页面新增并完整反馈
p95 不超过 16ms。LibreOffice 必须无修复打开，并用导出几何验证位置、尺寸与预设轮廓。

本票不实现画布拖拽绘制手势、形状库面板、组内新增、占位符、连接点吸附、填充/描边面板、改形状类型、
调节手柄、图片、表格或新增页面；这些能力在本命令和插入宿主被证明稳定后独立拆票。默认样式必须由
一个共享构造器定义，不能散落在命令、投影和 XML writer 三处形成漂移。

## Resolution

以公开纯数据 `AddShape` 命令完成了“新增后立即可编辑”的单一主干：命令只生成一个
`ElementTreePatch`，有效投影和 edit/view DOM 订阅既有增量失效，保存继续走
`ElementInsertionSource → baseline save`。新形状默认样式由 PPTX 解析器中的一份 OOXML 来源同时产出
当前主题上的 fill/stroke/text 语义与写回 markup，避免预览和保存各自猜默认值；开放连接线只在投影层
关闭填充，保存重开仍由同一预设语义恢复。

spid 分配器首次触碰 part 时扫描保留 XML 中全部 `cNvPr`，随后 O(1) 递增，并在远端高位结构 patch
到达后推进水位；元素分数序使用稳定 ElementId 打破并发同位。`p:spTree` 纳入统一 sequence 表，使新增
宿主落在 `p:extLst` 前且未知 XML 原位保留。预设名使用 own-property 判定，坐标在 px→EMU 后按
PowerPoint 的 32 位 signed/positive 域拒绝不可写回输入；事务失败会连同 element/spid 身份和选区原子回滚。

验收证据：

- 确定性固件重跑两次聚合 SHA-256 均为
  `0793c6109cb466279d3e0f7395a4df5d23025d5516062d40513ced95e3e346cf`。
- `npm run check && npm test && npm run build` 全绿：core 2117、edit-core 480、保存 71、editor 241、
  metafile 130；44 份固件 / 142 页 / 284 对独立进程 SVG 指纹完全一致，五个发布包构建成功。
- 真实 Chrome 验证新增后的拖拽、缩放、双击文字、撤销与 edit/view 增量 DOM；60 元素页完整反馈
  p95 为 0.500ms，几何偏差 0.000px，低于 16ms 预算。
- LibreOffice 无修复打开并导出 22323-byte PDF；roundRect frame 与四段圆角轮廓最大偏差
  1.000 SVG unit。双轴最终复审均为 `Findings: 0`。
- 实测发布体积：edit-core 主入口连静态共享 chunk 为 54.45KB gzip，首次保存额外 6.21KB；
  editor 为 29.57KB gzip，EN/CN README 已同步。
