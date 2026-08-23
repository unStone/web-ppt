---
title: 实现原生 SVG 点选与组进入
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./014-editor-session-static-view.md
---

## Question

如何让 `SlideEditor` 在编辑模式下直接使用浏览器 SVG hit-test，把 `pointerdown` 的 composed path
映射到稳定 `data-edit-id` 并提交 headless `Editor.select`，同时保持查看模式零选择副作用？

点选默认选择最外层组，双击进入组、Esc 逐层退出；锁定、用户隐藏和不可编辑节点必须跳过，
Alt+点击使用 `elementsFromPoint` 按 z 序循环被遮挡候选。绑定与销毁应属于单个视图，多视图共享
会话时不得重复提交或互相移除监听器；选择变化只更新交互层，不重建静态 SVG。

验收需在真实 Chrome 覆盖实心、无填充描边、重叠元素、嵌套组、Alt 穿透、查看模式与多视图销毁；
Node 契约验证所有选择都通过既有 `Selection` 规范化，点选事件到交互层更新不超过 8ms。框选、
世界/本地坐标换算、8 手柄和拖动不在本票内。

## Resolution

- `SlideEditor` 在单个视图根上拥有 `pointerdown` / `dblclick` / `keydown` 监听器；
  composed path 只在当前静态层内收窄 `data-edit-id` 为 `ElementId`，再统一调用
  headless `Editor.select`。挂载回滚、单视图 `destroy` 和会话销毁都对称退订；已销毁
  视图的 DOM 重新挂回文档也不会再提交选区。
- 未进组时点选最外层组；双击每次只进入一层，`Escape` 按同一父链退出一层。
  `edit-core` 公开带环检测的 `isElementDescendantOf`，选区规范化与 DOM 命中共用同一
  组后代语义；锁定、用户隐藏或 `editable:none` 的祖先会阻断整个分支。
- Alt+点击直接消费浏览器 `elementsFromPoint` 的从上到下结果，经当前进组边界和
  可编辑性过滤后去重循环，不自行近似 SVG 几何。查看模式早返回，不阻止默认事件、
  不改共享选区。
- 选择事件只替换 interaction SVG：克隆目标时保留祖先 `<g>` transform，并移除复制
  id 避免与静态层的 SVG 引用冲突。回归证明选择、进组和 Alt 轮选都不重建静态 SVG
  或增加历史记录，多视图只同步共享选区的交互反馈。
- 新增确定性 `sample-editor-hit.pptx`，固定放置实心、无填充描边、重叠与两层嵌套组；
  连续生成 SHA-256 均为 `72ace4e166867bf69ef67b8d24a8ffc728a53627e420df09a6620f77e08d7f55`。
  真实 Chrome 用固定坐标的 `elementFromPoint` 验证 noFill 中心不命中、描边命中、顶层与
  Alt 穿透、嵌套进退、view 模式与多视图销毁；Playwright 外部会话再次观察到 PASS。
- 最终 Node 24 项 editor 断言全绿，60 元素点选到交互层 p95 `0.254ms`；真实
  Chrome p95 `0.100ms`（预算 8ms）。`npm run check`、完整 `npm test`、`npm run build`
  顺序全绿：27 份固件 / 105 页 / 210 对独立进程 SVG 指纹一致；`bench:edit` 全部预算通过。
  editor 构建为 `4.43kB gzip`，npm dry-run 为 16.9kB / 11 文件。Spec 与 Standards/Fowler
  双轴复审均无残留。
