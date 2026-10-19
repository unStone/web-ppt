---
title: 为 SmartArt matrix1 / radial1 补固件与重排验收
status: closed
priority: P3
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

现有六个布局族里，snake（matrix1）与 radial（radial1）此前没有固件。改字、增删节点之后，它们的 DiagramML 与 drawing 缓存是否保持一致、重排结果是否符合布局族的结构？

## 范围

只补确定性固件与验收，不改布局算法；不实现完整 constrLst 约束求解，不宣称与 PowerPoint 像素一致。官网 SmartArt 数据面板已覆盖这两个布局族，无需新入口。

## Answer

| 部分 | 结果 |
|---|---|
| 固件 | `sample-smartart.pptx` 增加第 7 页 matrix1（四格）与第 8 页 radial1（中心 + 四个卫星），两页都只有 data + layout，走自研布局回退；`sample-smartart-edit.pptx` 随之派生 |
| 解析验收 | `tooling/test-core.mjs`：矩阵至少两行两列；径向首节点离中心最近；节点在画框内且不混入 parTrans / presOf 节点 |
| 编辑验收 | `tooling/test-smartart-edit.mjs`：两页改字、增删与重排后 DiagramML 与 drawing 缓存同含新文案，撤销恢复原数据 |
| 快照 | 两页两条文字路径各新增基线 |

真实 Office 样本的布局边界仍由 [008](008-native-object-scope.md) 跟进。
