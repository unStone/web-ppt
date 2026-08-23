---
title: 建立移动手势与拖动幽灵
status: open
labels:
  - wayfinder:task
parent: ../map.md
assignee: null
blocked_by:
  - ./016-selection-space-handles.md
---

## Question

如何让 `SlideEditor` 在已选元素上建立可恢复的 pointer capture 移动手势，把屏幕增量通过统一坐标
模块换算到元素父空间；拖动每帧只更新静态目标与 interaction overlay 的幽灵变换，`pointerup`
才提交一次 `SetXfrm`，从而保持 8ms 帧预算、一个手势一个历史组和精确 OOXML 写回？

需要明确点击与拖动阈值、单选/多选的共同位移、嵌套旋转翻转组的父空间增量，以及 `Escape`、
`pointercancel`、`lostpointercapture`、视图销毁和切页时的无提交回滚。真实 Chrome 要验证拖动中静态 SVG
节点与 defs 身份不变、松手只发生一次增量提交、撤销恢复原位置，60 元素页拖动帧 p95 不超过 `8ms`。

本票只实现移动，不绑定缩放/旋转手柄，不实现吸附、智能参考线或框选。

## Resolution

<!-- 完成时记录手势状态机、坐标换算、幽灵 DOM、取消语义、提交次数与 Chrome 性能。 -->
