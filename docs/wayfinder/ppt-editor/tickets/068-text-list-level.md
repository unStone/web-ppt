---
title: 实现文本列表升降级
status: open
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
