---
title: 打通 .ppt 编辑另存 .pptx 的产品闭环
status: open
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./064-generated-pptx-save.md
---

## Question

D12 承诺「`.ppt` 只读，编辑即另存为 `.pptx`」，但 [票据 063](063-integrate-site-editor-page.md) 因生成式
writer 缺失而把 `.ppt` 强制锁进 view 模式。生成保存落地后，如何让用户对 `.ppt` 进入编辑、在**第一次进入编辑时**
（而不是保存失败时）得到一次明确的格式转换提示，并带走合法的 `.pptx`？

| 维度 | 要求 |
|---|---|
| 提示时机 | 进入 edit 即提示「将另存为 .pptx」，用户确认后才允许命令；拒绝则停留 view |
| 语义保留 | 已解析的几何 / 文字 / 动画 / 母版继承按现有投影进入生成物；`.ppt` 独有且 Schema 未建模的内容按框架对象降级并如实告知 |
| 边界 | 不写回 `.ppt`（Out of scope 不变）；文件名默认 `原名.pptx` |
| 接线位置 | editor.html 的 `documentKind` 边界与保存链路（[editor-page.ts](../../../../packages/site/src/editor-page.ts)）、`@web-ppt/editor` adapter 的 `documentKind` seam |

验收：真实浏览器打开 `sample.ppt` → 提示 → 编辑 → 保存 → LibreOffice 无修复打开；拒绝转换路径保持 view 且零命令；
React/Vue adapter 同一 seam 不复制状态；全部门禁绿。
