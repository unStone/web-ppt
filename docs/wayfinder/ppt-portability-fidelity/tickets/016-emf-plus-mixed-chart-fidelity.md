---
title: 补齐 EMF+ 拒绝记录与混合图外观首批修正
status: closed
assignee: cursor
priority: P3
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./009-render-fidelity-scope.md
---

## Question

如何按 [009 调查结论](009-render-fidelity-scope.md) 补 EMF+ SourceCopy/色变换/竖排/扩展裁剪的可验证路径，并修正混合图轴域、同侧标签与气泡半径外观？

## 范围

艺术字包络与三维材质后置；必须有可复现输入与外部对照。

## Answer

### EMF+

| 项 | 结果 |
|---|---|
| SourceCopy（0x4023） | 接受并进入状态；绘制时将 ARGB 透明度抬到不透明以近似源覆盖；随 Save/Restore |
| ImageAttributes | 解析 ObjectType=8；wrap-only 可绘；尾部 5×5 色矩阵 → `feColorMatrix` |
| 竖排 | DrawString `flags&2` 叠字 + `rotate(-90)`；DriverString 允许 `Cmap\|Vertical`，仍拒 glyph-index |
| 裁剪 | mode 2 Union 并列几何；mode 3/4/5 拒绝并写明「无法用 SVG clipPath 表达」 |
| 验收 | `tooling/test-emf-plus.mjs` 增 SourceCopy/色矩阵/竖排/Union/XOR 用例（合计 45 项） |

### 混合图外观

| 项 | 结果 |
|---|---|
| 自动轴域 | `makeScale` 在双端均自动时对数据外侧留约 5% 再 nice 分级；显式 `c:min`/`c:max` 仍优先 |
| 同侧标签 | `xyInsets` 为同侧轴分配 `lane`，标签与留白外推 |
| 气泡半径 | 最大直径 = `min(plot)*25%*bubbleScale%`；`area` 取根、`w` 线性 |
| 验收 | `chart-shared-mixed-axes-contract.mjs` 增三项；既有混合图渲染契约仍绿 |

仍排除：艺术字包络、三维材质、嵌套图元、glyph-index、真实 Office Only EMF+ 样本（属 009）；不靠隐藏系列抬 SSIM。
