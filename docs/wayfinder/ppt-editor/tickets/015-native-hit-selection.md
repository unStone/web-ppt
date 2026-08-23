---
title: 实现原生 SVG 点选与组进入
status: open
labels:
  - wayfinder:task
parent: ../map.md
assignee:
blocked_by:
  - ./014-editor-session-static-view.md
---

## Question

如何让 `SlideEditor` 在编辑模式下直接使用浏览器 SVG hit-test，把 `pointerdown` 的 composed path
映射到稳定 `data-edit-id` 并提交 headless `Editor.select`，同时保持查看模式零选择副作用？

点选默认选择最外层组，双击进入组、Esc 逐层退出；锁定、用户隐藏和不可编辑节点必须跳过，
Alt+点击使用 `elementsFromPoint` 按 z 序循环被遮挡候选。绑定与销毁应属于单个视图，多视图共享
会话时不得重复提交或互相移除监听器；选择变化只更新交互层，不重建静态 SVG。

验收需在真实 Chrome 覆盖实心、无填充描边、重叠元素、嵌套组、Alt 穿透、查看模式与多视图销毁；
Node 契约验证所有选择都通过既有 `Selection` 规范化，点选事件到交互层更新不超过 8ms。框选、
世界/本地坐标换算、8 手柄和拖动不在本票内。

## Resolution

<!-- 完成时记录命中路径、组状态、监听器所有权、性能与浏览器证据。 -->
