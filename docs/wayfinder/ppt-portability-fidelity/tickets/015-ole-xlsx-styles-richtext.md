---
title: 实现 OLE 嵌入 XLSX 的单元格样式与 sharedStrings 富文本
status: closed
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
| 官网样式与富文本入口 | ✅ 嵌入对象面板新增选定单元格的样式表单（字体 / 填充 / 边框，空字段保持原值、颜色须为六位十六进制）与富文本表单（片段文字 + 粗斜体下划线 + 颜色），中英文文案齐全；浏览器契约覆盖应用、撤销（值不受影响）与英文文案 |
| 外部读取器验证 | ✅ `tooling/test-ole-edit-libreoffice.mjs`：改写后的 XLSX 经 LibreOffice 打开（fods 断言富文本文字）并重写往返（styles.xml 颜色与 sharedStrings 的 run 边界保留） |

## Resolution（2026-10-30 关闭）

全部完成条件满足：SDK（`setCellStyle` / `setCellRichText`）+ 官网面板样式与富文本入口（含中英文与撤销语义）+ LibreOffice 外部打开与重写往返验证。`readEmbeddedPackage` 随本票从 `@web-ppt/edit-core/ole` 公开导出，供宿主提取嵌入文档做外部验证。
