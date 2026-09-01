---
title: 编辑项目符号与自动编号
status: closed
assignee: /root
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

解析与渲染已经支持字符、自动编号和图片项目符号，九级列表继承重基也已完成，但 `SetParaProps` 不能创建、
替换、移除或恢复项目符号。如何把项目符号作为段落 Source Value / Override 接入纯数据命令、查询状态和
保留型写回，并确保 `a:buNone`、`a:buChar`、`a:buAutoNum`、`a:buBlip` 的互斥语义不会产生非法 XML？

范围包括字符/字体、自动编号 scheme/startAt、图片资源、颜色和相对/绝对大小；`null` 恢复版式/母版级别
来源，显式 none 屏蔽来源。改级、拆分/合并段落、富文本粘贴、格式刷、查找替换、表格文字、恢复与协同后，
自动编号必须连续且两条文本渲染路径一致。

验收：确定性固件覆盖继承、显式 none、字符、自动编号续号、图片与九级切换；模型/查询/历史、资源闭包、
补丁与生成保存、LibreOffice 文字几何 oracle、独立进程指纹和真实 Chrome 工具栏/键盘反馈全部通过，四段
仓库门禁全绿。

## Answer

项目符号现在是段落 Source Value / Override 的结构化值：`null` 清除直接覆盖并恢复版式或母版来源，
`{ kind: "none" }` 显式屏蔽来源，字符、自动编号和图片分别保存自己的类型参数，并共用字体、颜色、
相对/绝对大小样式。图片使用内容寻址资源引用；命令、历史、恢复、协同和剪贴板只传纯数据，投影时再解析为
可渲染资源。

所有会改变段落边界或级别的路径都会重新计算编号连续性。补丁保存与无源生成保存统一替换互斥的
`a:buNone`、`a:buChar`、`a:buAutoNum`、`a:buBlip` 标记，避免同一段落输出多个项目符号定义；图片资源会
随编辑历史、复制粘贴和保存闭包一起保留。编辑器公开了字符项目符号、自动编号、取消项目符号、列表升降级及
图片项目符号入口，工具栏与 `Ctrl/Cmd+Shift+7/8` 共享同一命令链路。

## Evidence

- 确定性固件 `sample-editor-bullets.pptx` 的 SHA-256 为
  `076781687894c2a0c9c9b3d874a53ca012eb0428b5c016b8d756bd6db5755350`，覆盖继承、显式 none、字符、
  自动编号续号、图片及九级列表。
- 模型与编辑保存分别通过 988、464 项断言，协同通过 111 项断言；73 个固件、247 页产生 494 对独立进程
  HTML/SVG 等价指纹，178 个渲染快照保持稳定。
- LibreOffice 实际渲染验证 `bullet-format-editing.pptx`、`bullet-image-editing.pptx` 和
  `generated-bullets.pptx`：字符/none/罗马数字/重新起号、九级缩进、图片坐标及无源生成三类项目符号均有
  独立几何证据。
- 真实 Chrome 验证工具栏、快捷键、图片项目符号样式以及保存后重新打开；图片字体、颜色和百分比大小未丢失。
- `npm run check`、`npm test`、`npm run build`、`npm run verify` 全部通过，验证器完成 285 项一致性检查。
- 规格完整性与工程标准双重复审均为 PASS。
