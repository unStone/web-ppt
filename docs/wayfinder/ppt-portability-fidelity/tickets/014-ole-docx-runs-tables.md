---
title: 实现 OLE 嵌入 DOCX 的 run 级改字与表格单元格文字
status: closed
priority: P3
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

如何在嵌入 DOCX 中只改一个 run 的文字而保留相邻 run 的粗斜体等格式，并编辑表格单元格里的普通段落，同时继续拒绝域、内容控件、图形和修订？

## 范围

模型与 SDK 在 `@web-ppt/edit-core/ole`。仍排除跨 run 格式合并、修订与内容控件内编辑、任意宿主原位激活。

## 当前进度

| 部分 | 状态 |
|---|---|
| 模型 | `OleParagraph.runs[]` 带粗体、斜体、下划线（`w:u w:val="none"` 视为无）、字号、颜色；`table` 记录表格内段落的行列；段落文字按全部 `w:t` 拼接，超链接里的 run 不丢 |
| SDK | `createOleEditor().setRun(id, paragraph, run, text)` 只改目标 run 的 `w:t`；整段替换仍走 `setParagraph` |
| 拒绝 | 含域、内容控件、图形、修订、换行符或制表符的段落整段不可编辑 |
| 契约 | `tooling/test-ole-edit.mjs`：多 run 改字后格式保留、表格单元格可写、超链接文字计入段落、域段落拒绝、保存重开与恢复一致 |
| 官网 run 级入口 | ✅ 嵌入对象面板每段下方列出各 run（带 B/I/U 徽标）单独改字（`editor-ole-data.ts` 的 `setRun` 入口），中英文文案齐全；浏览器契约覆盖改字、撤销（只回退片段）、重做与保存重开 |
| 外部读取器验证 | ✅ `tooling/test-ole-edit-libreoffice.mjs`：改写后重组的 DOCX 经 LibreOffice 转 Flat XML，改写的 run 文字在场 |

## Resolution（2026-10-30 关闭）

全部完成条件满足：SDK（`setRun` 只改目标 `w:t`，相邻 run 格式保留）+ 官网面板 run 级入口（含中英文与撤销语义）+ LibreOffice 外部打开验证（文字在场）。
