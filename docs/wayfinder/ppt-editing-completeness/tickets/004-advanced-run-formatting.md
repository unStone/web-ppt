---
title: 补齐字符高级格式与清除格式
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
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

## Answer

统一 Schema 以 `underline` / `strikeType` 保存 DrawingML 精确枚举，同时保留派生的 `u` / `strike`
布尔字段兼容旧消费者；旧布尔写入会在首次编辑时确定性迁移成 `sng|none` 与
`sngStrike|noStrike`。高亮、CSS px 字距、大小写和百分比基线共用同一套字符属性 Schema、直设位、
继承重基、混合查询、格式刷与富文本片段模型，两条渲染路径只消费统一 `TextRun`。

`ClearFormat` 在选区 mark 上记录“删除来源视觉直设”的意图，保存时从原 `a:rPr` 移除完整字符格式组，
但保留链接、字段、公式和段落来源身份。折叠光标不制造零宽 run，而是把清除意图留在所属输入视图，
与下一次普通输入或 IME 作为一个事务提交。

## Evidence

- 确定性固件覆盖 `none` + 17 种下划线、单双删除线、高亮、正负字距、大小写、上下标、版式/主题继承、
  字段/超链接/公式与 2,000 字符；双生成 SHA-256 均为
  `5650191f2f0c71ef23ba08033c5abd57eaa28357220efe4b8bcd6ea554f29772`。
- 结构查询、混合选区、空 run、历史/恢复、字段级 LWW 协同、格式刷、表格文字、富文本剪贴板、补丁与
  生成保存、180 个双路径快照及 498 对独立进程指纹通过。
- 真实 Chrome 验证可信输入/IME、Safari engine 行盒和官网格式面板保存重开；LibreOffice 导出 PDF
  验证点划线/双删除线、small caps、baseline 与清除字段格式，产物 33,898 bytes。
- `npm run check && npm test && npm run build && npm run verify` 全绿：4,351 项断言，其中 core 2,188、
  edit-core 1,025、保存 475、PowerPoint 证据 9、editor 398、adapter 9、collab 117、metafile 130。
