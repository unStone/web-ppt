---
title: 补齐表格结构与单元格格式编辑
status: open
assignee: /root
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

现有表格只能在末尾追加行，来源格按瞬时坐标寻址，无法安全插删行列、合并拆分或改变行高列宽。如何把
表格建模成具有稳定行列身份和单一合并真值的可编辑网格，同时保持现有 `TableElement` 渲染 Schema、
表样式优先级、稀疏 Source Value / Override 语义和补丁保存边界？

范围包括任意位置插/删行列、合并/拆分、行高列宽与 `SetCellProps`；结构事务必须同步维护 frame 尺寸，
禁止重叠/越界合并与悬空覆盖格，并让文字覆盖、条纹样式、撤销重做、恢复、协同重基和生成保存都继续指向
同一逻辑单元格。删除穿过合并区域时必须产出 PowerPoint 可无修复打开的确定结果，不能留下 OOXML 半状态。

验收：新增含横纵合并与直接单元格格式的确定性固件；模型不变量、固定种子并发、恢复、补丁/生成保存、
LibreOffice 网格 oracle、独立进程等价指纹和真实 Chrome 60 格完整反馈预算全部通过；旧 `InsertRow` 省略
位置时仍兼容尾部追加语义，四段仓库门禁全绿。
