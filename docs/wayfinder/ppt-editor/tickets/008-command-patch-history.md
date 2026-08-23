---
title: 建立命令、事务与双向 Patch 历史
status: open
labels:
  - wayfinder:task
parent: ../map.md
assignee:
blocked_by:
  - ./005-prove-m0-equivalence.md
  - ./011-render-element-api.md
  - ./012-render-text-html-api.md
  - ./013-layout-text-api.md
---

## Question

如何实现可序列化命令、原子事务、正逆 patch、选择恢复和 500ms 合并规则，并先用 `SetXfrm` 证明撤销、重做与随机命令不变量？

## Resolution

<!-- 完成时记录 API、不变量、属性测试与性能。 -->
