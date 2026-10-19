---
title: 实现 OLE 嵌入 DOCX 的 run 级改字与表格单元格文字
status: in-progress
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
| 待完成 | 官网嵌入对象面板的 run 级编辑入口与中英文文案；外部读取器（LibreOffice / Word）打开改写后文档的验证 |
