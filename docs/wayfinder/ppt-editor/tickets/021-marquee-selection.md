---
title: 实现 PowerPoint 语义框选
status: open
labels:
  - wayfinder:task
parent: ../map.md
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

<!-- 完成时记录空白手势仲裁、当前组候选、OBB 完全包含、取消语义与 Chrome 精度/性能证据。 -->
