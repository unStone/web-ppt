---
title: 绑定缩放手柄并提交尺寸
status: open
labels:
  - wayfinder:task
parent: ../map.md
assignee: null
blocked_by:
  - ./017-drag-move-gesture.md
---

## Question

如何让 interaction SVG 的 8 个缩放柄拥有比视觉大 4px、且不随 zoom 改变的命中区域；复用现有
pointer capture 与幽灵帧状态机，在元素未旋转本地系中保持对角锚点，正确提交旋转/翻转、嵌套组和
多选的 `x/y/w/h`？

四角支持双向缩放、四边中点只改一个轴；`Shift` 保持原宽高比，`Alt` 从中心，组合键同时生效。
拖过锚点时把负尺寸规范化为正 `w/h` 与 `SetFlip`，视觉不能跳边。拖动中不得重建静态 SVG 或写模型，
松手只形成一个事务；取消、丢失捕获、切页和销毁必须无提交恢复。真实 Chrome 在 0.5/1/2 zoom 下
验证锚点屏幕偏差不超过 0.5px、60 元素缩放帧 p95 不超过 8ms，并保存重开验证 OOXML。

本票不实现旋转柄、吸附、智能参考线、调节柄、裁剪柄或框选。

## Resolution

<!-- 完成时记录 8 柄状态机、旋转中心修正、修饰键、翻面语义、写回和 Chrome 证据。 -->
