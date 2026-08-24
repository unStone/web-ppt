---
title: 绑定旋转柄并提交角度
status: open
labels:
  - wayfinder:task
parent: ../map.md
assignee: null
blocked_by:
  - ./018-resize-handle-gesture.md
---

## Question

如何让顶部旋转柄复用统一 pointer capture/rAF 生命周期，以选择中心为轴把屏幕指针角度转换成元素父空间
的顺时针 `rot`；单选正确处理自身翻转与多层旋转/翻转组，多选则围绕共同 AABB 中心同步更新每个选择根
的中心和角度，同时保持静态 DOM、defs 与模型在手势期间不变？

`Shift` 把角度约束到 15°，可在手势中动态按下/释放；跨越 ±180° 时必须连续累计，不能倒转 360°。
松手只形成一个事务并精确写回 OOXML 的 1/60000 度；Escape、指针取消/丢失、切页、zoom、view、
外部更新和销毁均无提交回滚。真实 Chrome 在 0.5/1/2 zoom 下以 `getScreenCTM()` 验证幽灵角度与中心
误差不超过 0.5px，60 元素页旋转帧 p95 不超过 8ms，并以可信鼠标输入验证 capture 与撤销。

本票不实现对象/画布吸附、参考线、框选、黄色调节柄、裁剪柄、线端点或键盘移动。

## Resolution

<!-- 完成时记录角度连续性、父空间换算、多选中心、Shift 约束、写回和 Chrome 证据。 -->
