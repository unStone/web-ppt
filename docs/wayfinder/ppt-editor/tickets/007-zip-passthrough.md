---
title: 实现 ZIP 原始条目直通保存
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

如何解析中央目录并原样搬运未修改条目的本地头、额外字段和压缩流，同时对 zip64、数据描述符、注释与加密条目做可解释降级？

## Resolution

<!-- 完成时记录格式矩阵、字节断言、降级行为与保存基准。 -->
