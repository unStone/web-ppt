---
title: 建立顶点编辑独立扩展
status: closed
assignee: /root
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

## Resolution

`custGeom` 已收敛为稳定的路径 / 命令 / 锚点 / 控制柄地址模型，`SetGeometry` 与显式
`ConvertToCustomGeometry` 贯通投影、历史和保留型保存；来源 `arcTo` 默认保持精确语义，进入顶点编辑时才按最终
OOXML 顺序物化为可寻址贝塞尔。直线、二次 / 三次贝塞尔、复合子路径闭合均可切换或拖动，`avLst` / `gdLst`
及未建模列表原样保留；命令、远端 Patch 与文档不变量共同拒绝公式和值的双真相。

`@web-ppt/editor/vertex` 作为独立入口复用 pointer capture / rAF，只在 interaction layer 预览并在松手形成一个历史单元。
60 元素真实 Chrome 顶点拖动偏差 0px、p95 0.2ms；主入口构建期基线保持 256631 bytes / 63305 bytes gzip，零增长。
固定种子编辑→撤销→保存→重开、圆弧地址稳定、确定性固件、LibreOffice 落点与填充 / 孔洞 / 描边像素 oracle 均通过；
`npm run check && npm test && npm run build` 同轮全绿，Spec / Standards 最终复审均无 P0/P1/P2。
