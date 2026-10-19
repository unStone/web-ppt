---
title: 实现 OLE 嵌入 XLSX 的单元格样式与 sharedStrings 富文本
status: in-progress
priority: P3
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

如何读写嵌入 XLSX 的单元格字体、填充与边框样式，以及 sharedStrings 中的多 run 富文本，同时不引入公式求值？

## 范围

模型与 SDK 在 `@web-ppt/edit-core/ole`。公式仍只改缓存值并要求宿主全量重算；排除数组 / 共享公式单格替换、受保护工作表、条件格式与数字格式。

## 当前进度

| 部分 | 状态 |
|---|---|
| 读取 | 单元格 `s` 经 `styles.xml` 解析字体（名称、字号、粗斜体、颜色）、纯色填充与边框；`<b val="0"/>` 等显式关闭按关闭处理；ARGB 与 RGB 颜色统一成 6 位 RGB；sharedStrings 多 `<r>` 读为 `richText` |
| SDK | `setCellStyle` 优先复用相同的 font / fill / border / xf，否则追加；`setCellRichText` 追加 `<si><r>…` 并设 `t="s"`，传 `null` 时去掉格式、保留文字 |
| 写入约束 | 新写入的颜色是 4 字节 ARGB；新建 styles / sharedStrings 关系时 Id 不与既有关系冲突 |
| 契约 | `tooling/test-ole-edit.mjs`：读取样式与富文本、写入后查询结果逐字段一致、去富文本保留文字、保存重开与恢复一致 |
| 待完成 | 官网嵌入对象面板的样式与富文本入口及中英文文案；外部读取器（LibreOffice / Excel）打开改写后工作簿的验证 |
