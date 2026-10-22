---
title: 命令工具面
status: open
priority: P2
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./001-structured-describe.md
  - ./002-layout-lint.md
---

## Question

怎样把现有 `EditDoc` 查询与编辑命令描述成 Agent 可调用的工具，并且每次编辑后立即返回布局观察（「一次编辑，一次观察」）？

## 范围

| 部分 | 说明 |
|---|---|
| 工具描述 | 每个公开命令都有 JSON Schema 输入描述，由命令类型生成，不手写 |
| 查询工具 | describe（001）、单元素样式查询、lint（002）、渲染（003） |
| 编辑工具 | 单条与批量命令；批量命令在同一事务内原子提交，任一失败则整体拒绝 |
| 提交结果 | 受影响元素 id、该页 lint 结果；失败返回稳定 reason 与出错命令序号 |
| 会话 | 打开、保存（补丁保存或生成保存）、撤销 / 重做，沿用 `Editor` 历史 |

实现前确定是否与 005 的 MCP 包合并为同一个新包，结论写入地图 Decisions。

## 完成条件

- 全部公开命令都有 Schema，`npm run verify` 比对 Schema 与命令类型，新增命令漏写 Schema 时 verify 失败。
- 非法输入（Schema 不符、目标 id 不存在、命令语义拒绝）各有原子拒绝测试：文稿与历史均不变。
- 批量命令一次撤销即可整体回退。
- 保存产物通过补丁保存与生成保存两条路径的现有保存门禁，并由 LibreOffice 与独立读取器无修复打开。

## 不做

- 不新增编辑语义：工具面只暴露已有命令，新编辑能力先进 edit-core。
