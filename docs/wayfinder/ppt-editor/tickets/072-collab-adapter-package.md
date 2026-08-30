---
title: 建立协同适配扩展包
status: closed
assignee: /root
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

M6 后置项、D13 承诺。模型侧的前置条件已成立：扁平记录 + 字段级覆盖、协同安全分数序（票据 004）、
远端 origin 不进本地历史且支持路径 rebase（票据 008）。如何做成独立适配包，把 EditDoc 的 patch 流
接到 CRDT / LWW 通道上，同时单机主包保持零协同依赖？

| 维度 | 要求 |
|---|---|
| 包边界 | 新包（如 `@web-ppt/collab-*`），以 `edit-core` 为 peer；单机用户零成本（取舍规范：按需注入即零成本） |
| 需要决策 | 传输与合并选型：Yjs 绑定 vs 自研字段级 LWW + 分数序（Excalidraw 路线）。在本票据内比较后定，标准：包体积、离线合并正确性、与双向 patch 的映射复杂度 |
| 一致性 | 并发 SetXfrm / 文本编辑 / z 序 / 页序的收敛性有属性测试；富文本并发格式化按 Peritext 结论评估，超出范围的显式列非目标 |
| 冲突面 | 同元素并发删除/编辑、同页并发插入的分数序不撞、身份水位不倒退（复用恢复日志的验真思路） |
| 边界 | 不含网络层与服务端实现，只到「可插拔 provider」接口；演示用 BroadcastChannel 双标签页 |

验收：双实例固定种子并发脚本收敛到同一 EditDoc；断线重连补丁重放幂等；保存产物与单机语义一致；
主包体积回归零增长；全部门禁绿。

## Resolution

选择独立的 `@web-ppt/collab` 字段级 LWW 适配包，而不引入 Yjs 镜像文档：现有绝对 Patch、分数序与恢复日志可直接映射，
`edit-core` 只增加双向 Patch / recovery / 身份分配 seam，单机 `editor` 入口仍零协同依赖。provider 仅负责消息搬运与唯一
replica slot；BroadcastChannel 给出双标签页实现。富文本当前按完整 `TextOverride` 寄存器收敛，Peritext 式字符级意图保留明确
列为非目标。

合并层已贯通字段 LWW、remove-wins、确定性页序、层级快照重基、严格同副本 sequence 因果前缀、原子 deferred 隔离与有界
checkpoint；逻辑 id 及全部新增 OOXML 数值身份按 4096 个 slot 精确分区，远端补丁不进入本地撤销历史。98 项契约覆盖固定种子
并发、120 种嵌套结构投递排列、随机结构 / 撤销链、断线重放、恢复与双标签页；薄包 12160B gzip（不含 peer），主编辑入口
保持 256631B / 63305B gzip，Spec / Standards 最终复审均无 P0/P1/P2。

2026-08-30 按用户决策将真实浏览器性能复验后置到功能开发收尾；既有预算与测试脚本保持不变。本票以类型检查、全部非性能
测试、构建及上述专项契约收口，受扰环境下的性能超标不作为协同功能失败。
