---
title: 实现表格样式应用与写回
status: open
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

M6 后置项。core 已解析内置表样式（[builtin-table-styles.ts](../../../../packages/core/src/pptx/builtin-table-styles.ts)），
编辑侧如何让用户切换表样式与条带开关，而不与既有的单元格直接格式（票据 043/047）冲突？

| 维度 | 要求 |
|---|---|
| 命令 | `SetTableStyle`：styleId + firstRow / lastRow / bandRow / firstCol / lastCol / bandCol 六开关；`null` 恢复来源 |
| 目录 | 公开可枚举的样式目录 seam（内置 + 文档自带 `tableStyles.xml`），供任意 UI 渲染预览 |
| 冲突语义 | 直接格式（票据 043 的自包含格式、047 的填充描边）优先级高于表样式，切换样式不清洗既有覆盖——与 PowerPoint 行为一致 |
| 写回 | `a:tblPr` 属性与 `a:tableStyleId` 最小改写；文档缺该样式时按需物化进 `tableStyles.xml` |

验收：切换 → 撤销 → 保存 → 重解析投影指纹一致；六开关逐一有固件断言；LibreOffice 打开样式渲染 oracle 通过；
全部门禁绿。
