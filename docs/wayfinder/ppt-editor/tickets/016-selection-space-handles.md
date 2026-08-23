---
title: 统一画布坐标并绘制选择框手柄
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
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

新增 `@web-ppt/editor` 根入口公开的纯坐标模块，以 SVG 仿射矩阵统一元素 frame、幻灯片和屏幕空间。
元素自身按 `rotate(center) · translate(off)`，每层祖先组再按 core 的
`rotate · translate · flip · scale(chExt/ext) · translate(-chOff)` 组合；目标自身 flip 不改变 frame，
逆矩阵显式拒绝奇异变换。元素 frame 与父级子坐标分别有公开正逆 seam，普通、旋转翻转与两层组的
600 个确定性点往返最大误差不超过 `1e-9`。

interaction SVG 只使用幻灯片坐标：单选绘制精确四角 OBB，多选取各 OBB 的世界系 AABB 并集；
每次生成视图私有的 polygon、8 个缩放 rect、旋转 stem/circle，描边、手柄与 24px 旋转距离均除以
当前 zoom，因此不会污染或重建静态 SVG。切页清空异页选框并在切回时恢复；view 模式隐藏交互层；
同一会话的不同 zoom 视图拥有独立 DOM 和尺寸。

确定性固件 `sample-editor-space.pptx` 覆盖普通、旋转+翻转与两层嵌套组。真实 Chrome 在
`0.5 / 1 / 2` zoom 下以静态 SVG 的 `getScreenCTM()` 为独立 oracle，9 组 OBB 最大偏差
`0.000px`；8 个缩放柄中心、旋转柄中心/24px 距离和全部尺寸的最大偏差也为 `0.000px`。
60 元素页选择到完整 9 手柄上屏 p95 为
`0.100ms`（预算 `8ms`）。Playwright 再从公开契约页确认 PASS。本票未绑定手柄事件、未提交
`SetXfrm`，也未实现拖动、吸附或框选。
