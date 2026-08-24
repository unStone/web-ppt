---
title: 实现文字框属性编辑闭环
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./037-grow-sp-autofit-text-shapes.md
---

## Question

如何让框架无关的属性面板通过纯数据 `SetBodyProps{ id, props }` 与查询 API，编辑普通文字形状的
垂直锚点、四向内边距、换行、文字方向、水平居中、分栏/栏距和
`none | normal | shape` 自动适应模式，并在 Chrome、Safari engine 行盒、SVG 导出、撤销重做与
保留型 OOXML 写回中立即得到同一结果？

命令只接受 `editable=full && kind=shape` 且存在 `txBody` 的目标；表格单元格继续由后续
`SetCellProps` 管理，frame-only、无文字宿主和艺术字 warp 不得被静默改坏。每个字段必须支持显式值与
`null`“清除本层直设”，所以 edit 解析要仅在开启时保留 `a:bodyPr` 的本层字段及版式/母版回退值；
查询和有效投影必须显示清除后的继承结果，默认只读 Schema 不增加编辑状态。

自动适应三个子元素互斥：`none` 写 `a:noAutofit`，`normal` 写裸 `a:normAutofit` 并交给既有实时比例
求解，`shape` 写 `a:spAutoFit` 并在同一事务派生一次 `FitTextShape`；清除本层模式则恢复继承。
改变任何会影响行盒的 body 属性后，如果有效模式为 `shape`，也必须原子重算形状高度和锚点。
同一历史要支持合并、撤销/重做与远端未记录 rebase，且不得写 `fontScale`、测量行盒或来源 `src`。

保存只增量修改目标 `a:bodyPr` 的对应属性/互斥 autofit 子元素，保留 `prstTxWarp`、`extLst`、未知节点、
`a:lstStyle`、全部段落以及未触碰 ZIP 条目。确定性固件覆盖本层直设、版式/母版继承、四种文字方向、
分栏、三种 autofit、空文字框及非目标；保存重开必须逐字段等于有效投影，两条预览指纹一致，
LibreOffice 无修复打开。

`@web-ppt/editor` 要公开与选区绑定的 `queryBodyProps` / `setBodyProps` seam，使 React、Vue、Web
Component 适配器无需接触 DOM 内部；view 模式和多选/无效选区只读且返回明确失败。真实 Chrome 对
browser/engine 连续执行 80 次属性提交，每次模型、静态层、编辑面和选择框同步，p95 不超过 30ms。

本票不实现属性面板视觉设计、表格单元格属性、表格末格新增行、艺术字 warp 编辑、手动缩放时自动
切换模式，也不新增任何框架运行时依赖。

## Resolution

`core` 在 edit 解析时以位集保留 bodyPr 本层来源及版式/母版回退，默认预览不增加编辑状态；
`edit-core` 以纯数据 `SetBodyProps`、查询和稀疏 override 统一八类属性，显式同值仍形成直设，
`null` 删除本层声明。三个 autofit 子元素互斥，`shape` 与同事务 `FitTextShape` 共用既有因果历史，
空文字框保持空状态但仍能查询、编辑和保存属性。

保留型 writer 只改目标 `bodyPr` 属性和 autofit 子元素，未知节点、warp、extLst、段落及其它 ZIP
条目保持不变；`@web-ppt/editor` 公开与单元素/文字选区绑定的 query/set seam，view、组合输入与多选
明确拒绝。确定性固件两次生成 SHA-256 均为
`2e455fd3790666e58a9e64a2495697c8eaef60acf4cbf8721d2625fbcb706475`。

Chrome 80 次连续提交 browser/engine p95 为 1.4/0.7ms、frame 偏差 0；43 份固件、140 页的
280 对独立进程 SVG 指纹一致。LibreOffice 无修复导出 PDF，独立 SVG oracle 覆盖逐字竖排、
分栏/栏距/边距/底部锚点、shape/none autofit，最大偏差 2.419 unit。规格与工程双轴复审 clean；
最终 `npm run check && npm test && npm run build` 全绿。
