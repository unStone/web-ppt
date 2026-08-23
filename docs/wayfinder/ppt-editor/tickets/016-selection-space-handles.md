---
title: 统一画布坐标并绘制选择框手柄
status: open
labels:
  - wayfinder:task
parent: ../map.md
assignee:
blocked_by:
  - ./015-native-hit-selection.md
---

## Question

如何把屏幕 px、幻灯片 px 与组内本地坐标的变换集中到一个可测的坐标模块，使
`SlideEditor` 能在 interaction SVG 中为普通元素、旋转/翻转元素与嵌套组绘制精确 OBB、8 个
缩放手柄和旋转手柄，而不让后续拖动、框选和吸附各自重写变换数学？

坐标必须与 core 现有组 `off/ext/chOff/chExt`、rotation 和 flip 渲染变换严格对偶；zoom
只存在 stage CSS transform，交互层始终使用幻灯片坐标。选择变化只更新 overlay，查看模式不显示
手柄，切页和多视图不得共享 DOM 身份或可变矩阵。

验收要用纯数学属性测试守住点和逆变换往返，并在真实 Chrome 的 `0.5 / 1 / 2` zoom 下覆盖
普通形状、旋转+翻转与两层嵌套组；手柄屏幕坐标与浏览器 `getScreenCTM` 的独立 oracle
偏差不超过 `0.5px`，60 元素页选择变化到完整手柄上屏 p95 不超过 `8ms`。本票不绑定
手柄指针事件，不提交 `SetXfrm`，不实现拖动、吸附或框选。

## Resolution

<!-- 完成时记录矩阵语义、组变换对偶、手柄 DOM 身份、Chrome 偏差与性能。 -->
