---
title: 编辑并预览元素动画时间线
status: open
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by: []
---

## Question

如何让任意 UI 框架通过稳定 `SlideId` / `ElementId` 编辑元素动画顺序、触发方式和时长，并在查看、编辑两种
模式中即时复用既有播放层，同时保持复杂来源时间树、撤销、恢复、页面/元素操作、保留型 `.pptx` 保存和默认
静态预览性能？

技术方案已约定公开命令 `SetAnimations { slideId, steps }`。`steps` 接受严格纯数据的有序时间线或 `null`：
`null` 删除本次覆盖并恢复来源，`[]` 明确删除当前页动画。每步以稳定 `ElementId` 指向当前页仍存在且可动画的
根或组内元素，公开 `effect`、`kind`、`trigger`、`delayMs`、`durationMs`、可选方向与运动路径；点击分组由顺序和
`click` / `withPrev` / `afterPrev` 自动推导，不向调用方泄漏易失的 OOXML cTn id 或 spid。
`durationMs` 必须是 60–10000ms、`delayMs` 为 0–300000ms 的整数；入口/退出/强调/路径必须与效果、方向和路径数据相容，未知字段、原型、
非有限数、空路径、跨页或失效目标在落模前原子拒绝。`querySlideAnimations(doc, SlideId[])` 返回
effective/source/mixed/sourceMixed/direct；产品工具栏不得读取 `src/ovr`，批量修改继续使用既有事务并只产生一个
撤销项。

有效投影仍只产出 core `Slide.animations`，稳定元素身份在投影边界映射回当前 spid，不引入第二套画布模型。
来源 `AnimStep.target` 在建模时映射为稳定元素身份，复制页随新身份复制，删元素会在同一原子事务中清理引用；
新增页无动画，换版式不制造悬空引用。目标页时间线变化只失效该页且不重绘未命中页。`SlideEditor` 与共享
`WebPptAdapter` 公开当前页查询、设置和 `previewAnimations`：预览在 view/edit 都可用，默认播放 effective
时间线，也能先预览尚未提交的合法时间线；连续触发必须取消旧预览且不改模型、选区、历史或页面。React/Vue
继续只薄映射同一个 adapter，不复制状态机或产品 UI。

保存从首次触碰基线重建规范 `p:timing/p:tnLst`：入口/退出写可见性 `p:set` 与 `p:animEffect`，强调写对应
行为，路径写 `p:animMotion`；稳定顺序生成唯一 cTn id，trigger/delay/duration 与 motion path 精确回读。
显式修改只替换可编辑 `tnLst`，保持 `p:timing` 根未知属性、`p:extLst`、无关 MCE 和相邻节点；`[]` 清理
`tnLst`，若不再有其他 timing 子载荷则删除空 `p:timing`，`null` 让来源逐字节返回。任意未触碰的复杂来源
时间树继续原样直通；图表/SmartArt 内部 build、任意条件链、p14 扩展行为和路径顶点编辑不在本票中，显式替换
时不会伪装成已支持。新增页、复制页、连续保存及保存重开后的 effective 时间线必须一致。

确定性固件覆盖来源无动画、入口/退出/强调、四种方向、运动路径、三种 trigger、同组并发、timing 根未知属性、
`extLst` 与无关 MCE。Node 从发布入口验证目录、严格命令、查询混合态、历史/恢复、删元素/复制页、稳定身份、
最小 XML、连续保存和重开；真实 Chromium 验证 view/edit 预览、连续取消、多 view、adapter 及 React/Vue 共用
seam。60 元素时间线提交、200 页批量提交和连续预览必须实测并守住 16ms 交互预算；默认挂载不得创建动画
编辑控制器。保存产物进入统一 Office 清单并由 LibreOffice 实际打开；Windows PowerPoint 真机继续服从任务
010。本票不实现产品动画面板、任意 OOXML 时间树可视化、顶点编辑、媒体播放控制或自动放映编排。

## Resolution

<!-- 完成后记录公开契约、保存/兼容策略、性能与完整验收证据。 -->
