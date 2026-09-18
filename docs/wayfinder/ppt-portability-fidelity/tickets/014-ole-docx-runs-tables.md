---
title: 实现 OLE DOCX run 格式与表格单元格文字
status: closed
assignee: cursor
priority: P3
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./008-native-object-scope.md
---

## Question

如何在嵌入 DOCX 中支持单段多 run 改字（保留相邻粗斜体等）以及表格单元格内普通段落文字，同时继续拒绝域/sdt/drawing/修订？

## 范围

见 [008 调查结论](008-native-object-scope.md)。

## Answer

| 项 | 结果 |
|---|---|
| 模型 | `OleParagraph.runs[]` 带 `bold/italic/underline/size/color`；`table?: {row,col}` 标记 `w:tbl→w:tc` 段落 |
| API | `setRun(id, paragraph, run, text)` 只改目标 run 的 `w:t`，相邻 `w:rPr` 保留；`setParagraph` 整段替换时清空后续 run 文字但保留各自 rPr |
| 拒绝 | 域 / sdt / drawing / 修订 / br / tab 整段仍 `editable:false` |
| 固件 | `make-ole-edit-fixture.mjs`：多 run 标题、表格两格（含多 run）、域段 |
| 验收 | `tooling/test-ole-edit.mjs`：改 run 后粗斜体仍在、表格格可写、域拒绝、保存重开一致 |

仍排除：跨 run 格式合并算法、修订/内容控件内编辑、真实 Office 样本哈希（属 008）。
