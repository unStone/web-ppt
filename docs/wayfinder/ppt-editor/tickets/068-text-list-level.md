---
title: 实现文本列表升降级
status: closed
assignee: /root
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

段落属性 schema（[paragraph-property-schema.ts](../../../../packages/edit-core/src/paragraph-property-schema.ts)）
没有 `level`，文字编辑态的 `Tab` / `Shift+Tab`（附录 B）无从落地。如何让段落级别成为继承感知的稀疏覆盖，
并带动缩进与项目符号一起正确变化？

| 维度 | 要求 |
|---|---|
| 模型 | `SetParaProps` 增加 `level`（0–8）；投影按 `lvl${n}pPr` 继承链重新求值 marL / indent / buChar / buAutoNum / 字号 |
| 交互 | 文字编辑态 `Tab` / `Shift+Tab` 升降当前段（表格单元格内让位既有的跳格语义）；到达 0 / 8 级时不动 |
| 写回 | 只写 `pPr@lvl` 稀疏覆盖；显式恢复来源删除覆盖 |
| 一致性 | browser / engine 两条行盒路径的缩进与符号同步变化；autofit 跟随重排 |

验收：多级列表固件覆盖自动编号续号与符号切换；升降级 → 撤销 → 保存 → 重解析逐字符相等；
LibreOffice 打开缩进几何 oracle 通过；全部门禁绿。

## Resolution

`SetParaProps.level` 已以 0–8 级继承感知稀疏覆盖贯通 core 九级样式解析、edit-core 重基与续号、
browser / engine 投影、autofit、Tab / Shift+Tab、撤销历史及仅写 `pPr@lvl` 的保留型保存；
表格单元格继续保留原有 Tab 跳格语义，0 / 8 边界严格 no-op。

确定性固件覆盖未在正文出现的级别、自动编号、字符项目符号、页面局部 `lstStyle`、来源直设清除、
保存重开与外部 Patch 隔离；同页九级目录按值驻留，60 元素删除和组合热路径不再重复深拷贝。
LibreOffice 实件导出 PDF 通过，同级 x / 字号偏差不超过 2 SVG unit、三级缩进差 2399 unit；
`npm run check && npm test && npm run build` 全绿，Spec / Standards 最终复审均无 P1/P2。
