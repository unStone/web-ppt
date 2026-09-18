---
title: 实现 OLE XLSX 单元格样式与富文本 sharedStrings
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

如何读写嵌入 XLSX 的单元格样式（font/fill/border）与 sharedStrings 多 run 富文本，同时不引入公式求值引擎？

## 范围

见 [008 调查结论](008-native-object-scope.md)。

## Answer

| 项 | 结果 |
|---|---|
| 读 | 单元格 `s` → `styles.xml` 解析 font/fill/border；`sharedStrings` 多 `<r>` → `OleCell.richText` |
| 写 | `setCellStyle` 优先复用既有 xf，否则追加 font/fill/border/xf；`setCellRichText` 追加 `<si><r>…` 并设 `t="s"` |
| 公式 | 仍只改缓存值并标 `fullCalcOnLoad`；不求值 |
| 固件 | 同 `sample-ole-edit.pptx`：样式 xf、多 run sharedString |
| 验收 | `test-ole-edit.mjs`：读样式/富文本、写后 styles/sharedStrings 含新项、重开一致 |

仍排除：公式引擎、数组/共享公式单格替换、受保护工作表、条件格式/numFmt 全量。
