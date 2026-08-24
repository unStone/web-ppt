---
title: 实现基础文本输入与 IME 闭环
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./029-element-clipboard.md
---

## Question

如何以技术方案已经固定的三个公共 seam——发布的 `Editor.exec(EditText)`、
`openEditor(...).mount(...)` 的真实 DOM 输入面、`editor.save()` 后 core 重开——让用户双击可写文字形状，
在 SVG 外的 HTML `contenteditable` 覆盖层中完成中英文输入、选区替换、退格/删除、Enter 分段、
Shift+Enter 换行、撤销/重做和 IME 组词，并保证提交前后文字不跳位、保存后逐字符相等？

headless 模型必须把来源 `TextBody` 规范化为扁平段落文本 + 半开格式区间，`EditText { id, ops[] }`
保持纯 JSON、原子校验和双向 patch；公式 run 用对象替换符表示不可分原子，插入文字继承光标处格式，
删除/分段同步调整区间。投影再把扁平覆盖归一成 `TextBody`，相邻同格式 run 合并；保存只替换目标
`a:txBody` 的段落序列，保留 `a:bodyPr`、`a:lstStyle`、宿主、关系和未触碰 ZIP 条目。

编辑面必须由 `renderTextBodyToHtml` 生成并保留 `data-p/data-r`，用元素到幻灯片的完整仿射矩阵贴合形状；
编辑期间只隐藏静态元素的文字，不隐藏填充/描边。`beforeinput` 对可控输入走模型，`compositionstart`
到 `compositionend` 期间绝不重渲，结束时白名单回读 DOM 并形成一个撤销单元。Escape/点击外部退出文本态，
view 模式、框架对象、非文本形状、普通表单、其它视图和活动手势不夺取输入；多视图只让拥有编辑面的视图
操作 DOM，但模型提交仍同步到其它视图。

确定性固件覆盖多段多 run、空段、前后空格、硬换行、中文、日文、RTL、公式与自动缩放；真实 Chrome
用可信 `beforeinput`/composition 事件验证，按键到上屏 p95 不超过 `30ms`，IME 期间编辑面节点身份不变。
保存重开、两条文本渲染路径独立进程指纹与有效投影一致，LibreOffice 打开不得修复。

本票只实现文字内容编辑与既有格式继承；字体/字号/粗斜、段落属性、富文本粘贴、表格单元格、Safari
`engine` 绝对行盒和 autofit 节流分别沿本票建立的扁平模型、DOM Range 映射与输入生命周期后续扩展，
不得另建旁路。

## Resolution

以一个无 DOM 的扁平文字模型贯通三个公共 seam：`EditText` 只接收纯 JSON 操作，段落文本用半开 mark
保存格式与 OOXML 来源，公式以 U+FFFC 原子参与选择；投影、DOM `data-r` 与 `TextPosition` 保持一一对应。
插入只借来源继承 `rPr`，只有原内容能克隆动态 `a:fld`/公式，从而守住字段邻接输入、RTL 拆段和空文本框
首次输入的既有格式。

DOM 侧复用 `renderTextBodyToHtml`，按完整仿射矩阵建立外置 `contenteditable`。受控 `beforeinput` 直达模型；
IME 开始时快照精确 Range 和模型文本，组词期间不换节点，结束时按两侧上下文回读纯文本并对非冲突外部更新
重放。未知浏览器包装只取文本；公式 Range 只能落在原子两侧。当前视图编辑时延迟静态 SVG 分区重绘，退出时
一次同步；外部点击、Escape、view 模式、原生表单与多视图所有权均有 DOM 契约。

写回只替换目标 `a:txBody` 的段落序列，保留 `bodyPr`、`lstStyle`、段落属性、字段、公式与未触碰 ZIP 条目。
M1 在独立进程比较 HTML/原生 SVG 两条路径的有效投影与保存产物；LibreOffice 打开产物并导出 PDF，未报告修复。

验证：确定性固件重生成聚合 SHA-256 不变；`npm run check`、`npm test`、`npm run build` 全绿；core 1987、
edit-core 368、editor 158、M1 32 项断言及 38 份固件 266 对独立指纹通过。真实 Chrome 连续/可信文字输入
p95 为 0.300/0.400ms（预算 30ms），两路规格/工程复核均无残留问题。

后续字体/字号/粗斜、段落属性、富文本粘贴、表格单元格、Safari engine 行盒和 autofit 节流继续复用本票
建立的 flat mark、Range 与输入生命周期，不另建编辑旁路。
