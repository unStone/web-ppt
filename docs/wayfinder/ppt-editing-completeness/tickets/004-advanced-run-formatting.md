---
title: 补齐字符高级格式与清除格式
status: open
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

core 已解析高亮、字距、大小写、baseline 等字符属性，编辑模型却只开放字体、字号、颜色、粗斜体、布尔下划线
和布尔删除线。如何把高亮、字距、大小写、上下标、17 种下划线与双删除线贯通 TextRun Schema、继承直设位、
`SetRunProps`、查询、两条渲染路径和 OOXML 写回，并提供只删除选区直接字符格式的 `ClearFormat`？

清除格式必须恢复 Source Value，保留文字内容、段落属性、超链接目标、动态字段和公式原子边界；混合选区、
IME、空 run、富文本剪贴板、格式刷、表格文字与 Safari engine 行盒不能丢身份或错误合并 mark。

验收：确定性固件覆盖所有新增属性及主题/版式继承，结构查询与历史/恢复/协同、补丁/生成保存、两路快照、
LibreOffice 文字 oracle、2,000 字符和真实可信输入契约通过；旧布尔下划线 API 有明确兼容策略，四段仓库
门禁全绿。
