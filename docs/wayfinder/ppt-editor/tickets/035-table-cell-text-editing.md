---
title: 实现表格单元格文字编辑闭环
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./034-safari-engine-text-editing.md
---

## Question

如何让用户双击可写表格中的非合并占位格，直接在该单元格矩形内复用既有 browser/engine 文字编辑面，完成
输入、删除、分段、字符与段落格式、富文本剪贴板、IME、撤销重做和已有单元格间的 Tab/Shift+Tab 导航，
同时保持其它单元格可见、保存后只改目标 `a:tc/a:txBody`，且不把单元格伪造成独立 `SlideElement`？

本票沿四个已经发布的 seam 做 TDD：`Editor.exec(EditText/SetRunProps/SetParaProps)` 的纯 JSON 命令新增可选
`cell: { r, c }`；`Editor.effectiveElement()` 仍投影标准 `TableElement`；`openEditor(...).mount(...)` 的真实 DOM
编辑面按目标格矩形与表格完整仿射矩阵贴合；`editor.save()` 后由 core 重开并分别走 HTML/SVG 预览。形状命令不带
`cell` 时必须逐字节/逐行为兼容，禁止用 `tableId:r:c` 伪造元素身份或建立第二套文字模型。

headless 文档在表格元素覆盖层中按坐标稀疏保存 `TextOverride`。命令、patch、选区、格式查询和历史必须同时校验
表格身份、坐标边界、合并占位格与可编辑性；有效投影只克隆受影响行/格，来源 Schema 不得被修改。保存层按
`graphicFrame` 的稳定 spid 定位 `a:tbl`，再按行列原位修改目标 `a:tc/a:txBody`，复用现有保留型 run/段落算法，
保留 `a:bodyPr`、`a:lstStyle`、`a:tcPr`、其它单元格、未知节点和未触碰 ZIP 条目。

core 的表格静态 markup 要给可见起始格稳定的行列身份，供命中和只隐藏当前格文字使用；标记不得改变视觉输出。
覆盖层的宽高、内边距、垂直锚点和竖排来自目标格，位置必须包含 `colSpan/rowSpan`、表格旋转/翻转和祖先组变换。
Tab/Shift+Tab 只遍历非 `merged` 的起始格，不离开编辑器；切格时提交当前模型并把光标放到目标格末尾。

确定性固件覆盖空格、富文本、多段、CJK/RTL、竖排、不同内边距、横纵合并格和裸 autofit。保存重开后目标文字与
格式等于有效投影，未编辑格的 XML 与预览指纹不变，LibreOffice 打开不得修复。真实 Chrome 同时验证 browser/engine
命中、可信输入、IME、Tab、其它格持续可见，并以 20×10 表格测量单次输入到完整上屏 p95 不超过 30ms。

本票不实现表格行列增删、合并拆分、单元格样式、列宽行高或末格 Tab 自动新增一行。末格增行必须由后续
`InsertRow` 结构命令承担，不能在文字控制器里直接改 `rows` 或 XML；在该命令完成前，末格 Tab 保持当前编辑面并阻止
浏览器焦点逃逸。autofit 的 100ms 节流与 `spAutoFit` 改高也继续独立处理。

## Resolution

以稀疏 `tableCells` 文字覆盖和可选 `cell: { r, c }` 目标扩展既有命令、选区、格式查询、历史与
保留型写回；表格仍是一个 `SlideElement`，有效投影只克隆受影响行/格，保存只改目标
`a:tc/a:txBody`。core 选择性输出单元格身份，同一 browser/engine 文字编辑面据单元格几何、
内边距、竖排和表格完整仿射矩阵贴合；其它格不隐藏，Tab/Shift+Tab 只遍历非占位格。

确定性固件覆盖复杂表格和 20×10 性能表，两次全固件生成哈希均为
`7296dc362fa04e4db49e437f8b7bb558c14a5b948708caf3ceb88fe9718e1440`。41 份固件 / 137 页 /
274 对独立进程原始 SVG 指纹完全一致；保存后 LibreOffice 无修复打开并导出 106878-byte PDF。
真实 Chrome 中 20×10 表格输入完整上屏 p95 为 0.500ms、编辑面贴合偏差 0.000px，
可信输入、IME 和 Tab 均通过。Spec/标准双轴终审无剩余发现。

末格 Tab 仍停在当前格并阻止焦点逃逸；自动增行留给后续 `InsertRow` 结构命令。
