---
title: 实现 SmartArt matrix1/radial1 原生编辑与重排验收
status: closed
assignee: cursor
priority: P3
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./008-native-object-scope.md
---

## Question

如何为 matrix1 / radial1（及对应 snake/radial 族）补确定性固件与重排验收，使改字、增删节点后 DiagramML 与 drawing 缓存一致？

## 范围

见 [008 调查结论](008-native-object-scope.md)。不实现完整 constrLst 约束求解；不宣称与 PowerPoint 像素一致。

## Answer

确定性固件与编辑验收已覆盖 `matrix1`（→ snake）与 `radial1`（→ radial）。引擎六族此前已在 `core/pptx/diagram.ts`；本票只补样本与契约，不改布局算法。

| 项 | 结果 |
|---|---|
| 固件 | `sample-smartart.pptx` 扩至 8 页：原缓存 + linear/cycle/pyramid/hierarchy/vList，新增 matrix1、radial1（无 drawing，走自研回退） |
| 编辑固件 | `make-smartart-edit-fixture.mjs`（已在 `postfixtures`）从主固件派生 GUID 身份与未知 data 扩展 |
| 解析验收 | core：矩阵页 ≥2 行×2 列；径向页中心距最近；节点在画框内；**不**做 PPT 像素比对 |
| 编辑验收 | 8 份 SmartArt 改字 / 增删 / 重排后，DiagramML `dataN.xml` 与 `web-ppt-drawing-*.xml` 同含新文案；撤销恢复原数据 |
| 门禁相关 | 快照 186→190；core 断言 2234→2259；`smartartEdit` 96→188；扩展能力合计 1789→1881 |

### 固件哈希（SHA-256）

| 文件 | 哈希 |
|---|---|
| `fixtures/sample-smartart.pptx` | `255e91d69611f393d41a1ea48426700481b83b5e9e13ca07797a8a5c9c880ac2` |
| `fixtures/sample-smartart-edit.pptx` | `dc04b3701d0f6549063d553a011f7ea3f5d7e1571501cf6be5267e26d3f923a2` |

### 版式身份

| 页 | `layoutDef@uniqueId` | `alg@type` | `layoutFamily` |
|---|---|---|---|
| 7 | `.../layout/matrix1` | `snake` | `snake` |
| 8 | `.../layout/radial1` | `sp` | `radial` |

### 证据命令

```bash
node tooling/make-smartart-fixture.mjs
node tooling/make-smartart-edit-fixture.mjs   # postfixtures 链已挂
node tooling/test-smartart-edit.mjs          # DiagramML↔drawing 一致
node tooling/test-core.mjs                   # 含 matrix/radial 结构断言 + 190 快照
```

仍排除：完整 constrLst/ruleLst、节点样式 API、与 PowerPoint 像素一致、真实 Office 样本（属 008 退出条件）。
