---
title: Agent 任务评测集
status: open
priority: P4
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./005-mcp-server-skill.md
---

## Question

lint 观察是否真的提高 Agent 完成编辑任务的成功率？怎样用可复跑的方式证明？

## 范围

| 部分 | 说明 |
|---|---|
| 任务 | 基于固件的编辑任务，每个任务有机器判定条件（describe 字段比对、lint 零错误、保存可重开） |
| 对照 | 同一 Agent、同一任务，分别在提交结果附带 lint 与不附带 lint 两种配置下运行 |
| 记录 | 任务定义、判定脚本、会话记录、产物与结果落盘到仓库工具目录 |

## 完成条件

- 任务、判定与结果文件可在仓库内一条命令复跑判定。
- 本票 Answer 记录两种配置的完成率与失败原因分布，并说明样本量的局限。

## 不做

- 不作为发布门禁；评测依赖外部模型，结果只作为接口设计的证据。
