---
title: 盘点并补齐附录 B 快捷键
status: closed
assignee: /root
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

[编辑能力技术方案](../../../editing-design.md) 的附录 B 是快捷键承诺清单，
实现散在各票据里，从未整体对账。哪些还缺，缺的补在哪一层（editor 包 / 产品层），补完后如何防止再漂移？

已证实的现状（2026-08-28 代码核对）：

| 快捷键 | 状态 |
|---|---|
| Ctrl+Z / Y / Shift+Z、Ctrl+C/X/V、Ctrl+Shift+V、Ctrl+D、Delete、方向键 ±Shift、Tab 遍历、Esc、Ctrl+[ ] 层级、Ctrl+B/I/U、文字内 Tab（表格跳格）、Ctrl+F/H | ✅ 已实现 |
| Ctrl+S 保存 | ✅ 产品层（editor-page.ts）拦截 |
| **Ctrl+A 全选** | ❌ 缺失（editor 包无 selectAll） |
| **Ctrl+Shift+> / <** 字号步进 | ❌ 缺失（SetRunProps 有 size，无步进接线） |
| **Ctrl+E/L/R/J** 段落对齐 | ❌ 缺失（SetParaProps 有 align，无快捷键） |
| **Ctrl+G / Ctrl+Shift+G** | ❌ 缺失 → [票据 067](067-group-ungroup-commands.md) |
| 文字 **Tab / Shift+Tab 升降级** | ❌ 缺失 → [票据 068](068-text-list-level.md) |
| Ctrl+M 新建页、F5 演示、PageUp/Down 翻页 | ⚠️ 命令/播放层就绪，键位未接——判定归 editor 包还是产品层后落位 |

要求：逐条落位或在附录 B 显式标注「产品层职责」；新增键位全部走既有 keyboard-owner / 事件视图隔离体系，
不新开监听通道；每条新键位有真实浏览器可信事件断言。

验收：附录 B 每一行都能指到实现或明确的职责标注；新增键位的 Chrome 可信输入契约通过；全部门禁绿。

## Resolution

附录 B 已逐行落到实现或产品职责：editor 补齐画布/文字双层 `Ctrl/Cmd+A`、逐 run 字号档位、段落对齐、
可写 PPTX 新建页与事件视图翻页；保存和 F5 继续由产品层负责，查找替换与表格 Tab 优先级也已补入索引。

页面级键位复用唯一文档控制器，内部切页通过公开回调同步 adapter、selection pane 与官网分页器；新页清空旧选择，
撤销重做按结构变化回显。混合字号以稳定线性区间逆序预测，IME composition / 229 边界完全避让，避免 run 分裂漂移
或未提交组词丢失。合成 DOM、真实 Chrome 可信输入、官网产品闭环及 `npm run check && npm test && npm run build`
全部通过；Spec / Standards 最终复审均无 P0/P1/P2。
