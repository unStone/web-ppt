---
title: 完成 0.6 集成验收
status: open
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./001-table-structure-editing.md
  - ./002-bullets-and-numbering.md
  - ./003-preset-shape-adjustments.md
  - ./004-advanced-run-formatting.md
  - ./005-common-object-and-slide-commands.md
  - ./006-touch-editing-gestures.md
  - ./007-batch-image-export.md
---

## Question

七条 0.6 能力各自关闭后，如何证明它们共同形成一致、可发现、可发布的产品面，而不是七组彼此割裂的命令？

对全部公开导出、editor/adapter seam、官网工具栏、快捷键/触屏冲突、恢复与协同协议、补丁/生成保存、包边界、
tree-shaking、错误文案和中英文文档做交叉审计；新增一份跨能力用户旅程，从新建文稿开始混合编辑表格、列表、
形状和页面，撤销/恢复后批量导出并保存重开。按实际构建更新 CHANGELOG、能力矩阵、断言数与体积，但不创建
tag、不推送也不发布 npm。

验收：固件连续生成两次字节一致，跨能力旅程在真实 Chrome 与 LibreOffice 通过，全部 Office 工件进入清单，
八包 API/版本/README 一致，`npm run check && npm test && npm run build && npm run verify` 全绿；审计确认地图
Destination 每项都有直接证据，才能关闭本票与地图。
