---
title: 编辑项目符号与自动编号
status: open
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
