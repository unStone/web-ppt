---
title: 编辑并即时预览页面切换效果
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by: []
---

## Question

如何让任意 UI 框架通过稳定 `SlideId` 编辑页面切换效果，并在查看、编辑两种模式中立即复用既有播放层预览，
同时保持撤销、恢复、页面操作、保留型 `.pptx` 保存和默认静态预览性能？

技术方案已约定公开命令 `SetTransition { id, t }`。`t` 接受严格纯数据的归一化切换值或 `null`：`null`
删除本次覆盖并恢复来源，`type: "none"` 明确关闭切换；其余值覆盖 core 已公开的标准、p14 与 p159/morph
类型，缺省时长为 750ms。时长必须在 80–5000ms，自动换片延迟必须是 OOXML 可表示的非负整数，方向和
`morphBy` 必须与效果类型相容，未知字段、原型、非有限数和非法组合在落模前原子拒绝。
`querySlideTransition(doc, SlideId[])` 返回 effective/source/mixed/sourceMixed/direct，产品工具栏不得读取
`src/ovr`；批量修改继续使用既有事务，一个用户动作只占一个撤销项。

有效投影仍只产出 core `Slide.transition`，不引入第二套画布模型。目标页切换变化只失效该页且不重绘静态 SVG；
所有挂载目标页的 view 查询同一模型，未命中页 DOM 身份保持。`SlideEditor` 与共享 `WebPptAdapter` 公开当前页查询、设置和
`previewTransition`：预览在 view/edit 都可用，默认播放当前 effective 值，也能先预览尚未提交的合法值；连续
触发必须取消旧动画且不改模型、选区、历史或页面。React/Vue 继续只薄映射同一个 adapter，不复制状态机或产品 UI。

保存从首次触碰基线重建：精确时长与 p14/p159 效果写在 `mc:AlternateContent` 的现代分支，旧版回退只写
标准 `p:transition`，morph 保留对象/词/字粒度；`none` 删除干净来源，需要阻断版式继承或保留未开放载荷时
写空载体，恢复来源则让基线原样返回。省略自动换片延迟时保留当前计时，避免与未开放的 `advClick` 组合成死页。
节点必须位于 `p:clrMapOvr` 后、`p:timing` 前，精确时长、自动换片、未知相邻节点、无关 AlternateContent、
timing、扩展属性和未触碰 part 保持。新增页、复制页、换版式、连续保存及保存重开后 effective 值必须一致。

确定性固件覆盖来源无切换、标准方向/分割、p14、morph、自动换片、timing 与未知相邻扩展。Node 从发布入口验证
40 种可播放效果加 `none` 的目录、命令严格性、查询混合态、历史/恢复、稳定页身份、最小 XML、连续保存和重开；真实 Chromium 验证
view/edit 预览、连续取消、多 view、adapter 及 React/Vue 共用 seam。200 页批量提交、单页完整反馈和连续预览
必须实测并守住 16ms 交互预算；默认预览不得创建任何切换控制器或动画。保存产物进入统一 Office 清单并由
LibreOffice 实际打开；Windows PowerPoint 真机继续服从任务 010。本票不实现元素动画时间树、切换面板 UI、
自动放映策略设置或逐帧 GPU 网格保真。

## Resolution

- 严格纯数据 `SetTransition` 与 `querySlideTransition` 已贯通 source/effective/direct/mixed、批量事务、撤销重做和恢复日志；`null` 恢复来源，`none` 明确关闭，方向、morph 粒度、时长及完整 OOXML `unsignedInt` 自动换片边界在落模前原子验证。省略自动换片延迟会继承当前计时，播放器支持 `0ms`，并把超过浏览器 32 位上限的延迟安全分段。
- view/edit 共用同一受控播放层和懒创建预览控制器；40 种可播放效果及所有公开方向都有可辨识关键帧，连续调用只取消自身动画，宿主动画、选区、文字编辑层与历史不受影响。复杂页出场层为 O(1) 空壳，不克隆页面、也不扫描后代动画；无框架 adapter 与 React/Vue 薄包均复用同一模型和动作 seam。
- 保留型写回按展开名识别标准、p14、p159 与 MCE，支持非标准命名空间前缀；现代 Choice 承载精确时长，旧版 Fallback 只含合法标准效果。同义来源标签、声音、点击策略、未知属性/子节点、未来 Choice 与相邻载荷原样保留；干净 `none` 删除来源，需要阻断继承或保留载荷时写空载体。新增页、复制页、换版式、连续保存和重开均逐字段等价。
- 确定性固件 `sample-editor-transitions.pptx` / `sample-editor-change-layout.pptx` 的 SHA-256 分别为 `305e385358aae80fa9f48c066b2769a6c58c9536ed3cb2fdd0ff9f25dcbba5dd` / `8bd6dc89a036327c36d51e884fd343aefda7a5d831c0b42a3878060f0f32eac3`。真实 Chromium 实测 40 效果加 60 元素复杂页预览创建 p95 `0.1ms`、200 页批量提交 `2.4ms`、单页完整反馈 `0.3ms`；React/Vue 排除 peer 后为 `934/1128B gzip`。
- 保存产物已由 LibreOffice 实际打开：41 页效果集和 1 页继承关闭案例分别导出 `65345` / `57119` 字节 PDF。Windows PowerPoint 真机证据继续由任务 010 管理，不以替代证据冒充。
- 精确运行 `npm run check && npm test && npm run build` 全绿：core 2141、edit-core 851、保存 348、PowerPoint 证据契约 9、editor 346、框架适配 9、65 份固件 / 234 页 / 468 对 HTML/SVG 原始指纹等价、metafile 130，七个发布包全部构建成功；需求与规范两路最终审查均为 0 项发现。
