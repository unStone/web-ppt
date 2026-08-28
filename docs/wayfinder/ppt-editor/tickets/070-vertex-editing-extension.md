---
title: 建立顶点编辑独立扩展
status: open
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

M6 后置项。如何以独立、可 tree-shake 的扩展实现自定义几何的顶点编辑，而不把复杂度带给不用它的用户？

| 维度 | 要求 |
|---|---|
| 范围 | `custGeom` 路径的锚点 / 控制柄拖动、线段直线↔贝塞尔切换、闭合切换；预设形状先「转为自由形状」（preset → custGeom 显式物化）再编辑，调节柄（adj 手柄）单独处理不混入 |
| 模型 | 新命令（如 `SetGeometry`）+ 路径点稳定寻址；分数 z 序与既有 xfrm 语义不动 |
| 交互 | 交互层绘制顶点手柄；拖动走既有 pointer capture / rAF 体系，每帧只动交互层 |
| 写回 | `a:custGeom` 保留型重建，`gdLst` / `avLst` 语义保留；preset 转换是一次显式命令，可撤销 |
| 体积 | 独立入口（如 `editor/vertex`），主编辑包零增重 |

验收：固定种子顶点编辑 → 撤销 → 保存 → 重解析路径逐点相等；LibreOffice 像素 oracle 通过；
拖动帧 p95 ≤ 8ms；主入口体积回归零增长；全部门禁绿。
