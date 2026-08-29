---
title: 实现表格样式应用与写回
status: closed
assignee: /root
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

## Resolution

core 已把文档自带与内置表样式收敛为公开目录、可渲染预览和统一优先级求值；`SetTableStyle` 以严格纯数据命令接通
六开关、`null` 恢复来源、历史与查询，单元格填充 / 边框及来源或会话字符直设始终压过表样式。文字 direct provenance
同时贯穿段落改级、版式重基和逐脚本字体槽，避免后续样式切换或生成保存把直接格式误当继承值。

保留型保存只最小改写 `a:tblPr` 与 `a:tableStyleId`，缺失样式或整个 `tableStyles.xml` 时按需补齐定义及 OPC 闭包；
生成式保存保留可继续切换的样式基线、命名空间和未知扩展。确定性固件 SHA-256 为
`48544a4a01ba0edbfdfd1fb28870278262535e45f8c597d6c33db8421d8eee4d`，六开关、撤销、补丁 / 生成重开后二次切换、
HTML / 原生 SVG 独立进程指纹与 LibreOffice 4/3/1/4/4 单元格 oracle 均通过；Spec / Standards 最终复审无 P0/P1/P2。
