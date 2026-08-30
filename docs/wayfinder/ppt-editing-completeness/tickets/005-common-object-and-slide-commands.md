---
title: 补齐分布、替代文字、节与页面尺寸
status: open
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

对齐、对象名称、页序与 `p14:sectionLst` 已有可复用基础设施，但编辑器仍缺少四组 PowerPoint 高频收尾能力：
水平/垂直等距分布、元素替代文字、节的增删改名/移动，以及整份演示的页面尺寸。如何把它们做成严格命令与
公开查询 seam，并保持一个用户动作对应一个原子历史单元？

分布只接受同页至少三个可移动最外层对象，复用世界 AABB 与父空间逆变换；替代文字写 `cNvPr@title/descr`
且与对象名称互不覆盖；节以稳定 SlideId 重建成员关系；页面尺寸 0.6 只开放“最大化”语义，不暗中执行
PowerPoint“确保适合”的全元素重排。所有命令都必须支持来源恢复、恢复日志、协同与保留型保存。

验收：每组能力有确定性固件和严格非法输入契约；撤销重做、跨页/组边界、删除/复制页后的节不变量、补丁与
生成保存、LibreOffice 打开/几何 oracle、公开 editor/adapter seam 和真实 Chrome 反馈预算通过，四段仓库
门禁全绿。
