---
title: 实现元素组合与解组
status: closed
assignee: /root
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

附录 B 承诺 `Ctrl+G` 组合 / `Ctrl+Shift+G` 解组，但命令层没有任何 Group/Ungroup 命令
（[commands/types.ts](../../../../packages/edit-core/src/commands/types.ts) 的 `Command` 联合中缺失）。
如何在保持稳定身份、分数 z 序与最小写回的前提下实现两者？

| 维度 | 要求 |
|---|---|
| 组合 | 多选同父直属元素 → 新 `grpSp`：求解组 `off/ext/chOff/chExt`，子元素世界变换不变；新组获得稳定 ElementId 与 spid |
| 解组 | 子元素回填父空间 xfrm，世界变换不变；组的名称/超链接等组级属性按来源语义处理 |
| 禁用边界 | 组带旋转 + 非等比缩放时解组不可逆（风险登记）→ 显式拒绝并给原因，不做静默近似 |
| 历史 | 一次手势 = 一个可撤销事务；撤销恢复选区与 z 序 |
| 写回 | `p:grpSp` 保留型插入/展开，未触碰兄弟字节直通；嵌套组合（组再组合）与跨组禁止（不同父）语义对齐 PowerPoint |
| 视图 | 多视图增量 DOM；组合后选中新组、解组后选中全部子元素；键盘 `Ctrl+G` / `Ctrl+Shift+G` 接入既有 keyboard-owner 体系 |

验收：属性测试覆盖嵌套 / 旋转 / 翻转组合的世界变换不变量（误差 ≤0.01px）；固定种子组合→解组→撤销全等；
LibreOffice 打开组合与解组产物无修复且几何 oracle 通过；真实 Chrome 60 元素组合/解组完整反馈 p95 ≤ 8ms；全部门禁绿。

## Resolution

- `Group` / `Ungroup` 以单个纯 JSON 层级 Patch 原子改写父链、分数序、删除集和选区；稳定 ElementId / spid、外部回放水位、锁定与跨父边界均由模型层统一约束。
- 新 `grpSp` 使用恒等子坐标系并物理迁移来源 XML 宿主；解组以仿射分解回填孩子 frame，旋转叠加非等比缩放或斜切会显式拒绝，名称、组级超链接、未知 XML 与动画 spid 均保持来源语义。
- `Ctrl/Cmd+G`、`Ctrl/Cmd+Shift+G` 已接入 keyboard-owner；新组复用孩子 DOM，来源组只重绘直属孩子，多视图、撤销重做和未触碰兄弟均保持增量身份。
- 固定种子属性测试、纯 JSON 恢复、生成式 / `.ppt` / 空白文稿、保存重开与 CI LibreOffice oracle 均已覆盖；真实 Chrome 60 元素组合/解组 p95 为 6.9/7.1ms，两路最终审查无剩余 P1/P2。
