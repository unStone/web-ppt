---
title: 实现 PowerPoint 语义框选
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./020-drag-snapping-guides.md
---

## Question

如何让编辑模式在空白画布按下并越过屏幕 3px 阈值后进入框选，而不和元素原生 SVG 点选、移动及
页面滚动争抢手势？橡皮筋只画在 interaction SVG，任意拖动方向都归一化为同一矩形；候选只来自
当前页或已进入组的直接可选子级，元素的世界 OBB 四角必须被框完全包含才命中，不能采用 Figma 式
相交即选中，也不能引入 Canvas / `Path2D` 命中近似。

拖动预览不得重建静态 SVG/defs 或写历史；松手一次替换 headless 选区，未越阈值的空白点击清空选区。
`Escape`、pointer cancel/lost capture、外部选区变化、切页、切模式与销毁都应清理橡皮筋并保留手势前
选区。真实 Chrome 需在 0.5/1/2 zoom 验证橡皮筋和旋转/翻转/缩放组元素的完全包含边界误差不超过
0.5px，60 元素页框选帧 p95 不超过 8ms。

本票不实现 Shift/Ctrl 增减选、方向键、Tab 顺序、套索、跨组框选或框选后的对齐/分布命令。

## Resolution

空白 `pointerdown` 不再立即清选区：共享的 pointer lifecycle 在屏幕 3px 内把它视为点击，
到 `pointerup` 才清空；越过阈值才快照当前页或已进入组的直属可选子项、计算世界 OBB 并创建
interaction SVG 预览。因此空白点击零候选扫描，拖动每帧只扫四角和更新固定节点，不重建
静态 SVG/defs、不写模型或历史，松手一次替换 headless 选区。

命中规则是归一化橡皮筋矩形完全包含候选的四个世界 OBB 角，屏幕容差固定为 `0.5px / zoom`；
相交或越界 `0.75px` 不命中。`enteredGroupOnSlide` 防止共享选区把上一页组上下文带入当前页。
`Escape`、cancel/lost capture、外部选区、缩放、切页、切模式与销毁统一经 `cancelGestures()`
清理交互层并保留手势前选区。

验收证据：两次生成确定性 `sample-editor-marquee.pptx` 的 SHA-256 均为
`46acfa5f83035c192185c6ad33ba2e550495a8e3665f3f20541ec00589835104`；79 项 editor 断言通过。真实 Chrome
在 0.5/1/2 zoom 下的旋转、翻转与多层非均匀缩放组框选最大误差为 `0.000px`；计入同步
候选几何、节点创建、rAF 更新与布局兑现后，60 元素首帧 / p95 为 `0.900/0.200ms`，可信
pointer capture 通过。全仓 `npm run check`、`npm test`、五包构建均通过；30 份固件 / 118 页 /
236 对编辑投影指纹完全一致，editor 发布入口为 `16.94KB gzip`。两路复审在修复跨页组泄漏与
首帧计时盲区后无剩余问题。
