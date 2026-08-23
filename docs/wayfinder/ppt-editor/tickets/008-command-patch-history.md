---
title: 建立命令、事务与双向 Patch 历史
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./005-prove-m0-equivalence.md
  - ./011-render-element-api.md
  - ./012-render-text-html-api.md
  - ./013-layout-text-api.md
---

## Question

如何实现可序列化命令、原子事务、正逆 patch、选择恢复和 500ms 合并规则，并先用 `SetXfrm` 证明撤销、重做与随机命令不变量？

## Resolution

- 默认入口新增无 DOM 的 `Editor`：`exec` / `transaction` 接收纯数据 `SetXfrm`，命令自己产出
  带 `origin` 的正逆 patch；只把显式字段写进 `ovr`，不修改 `src`。一次事务只广播一次精确
  元素/页失效，任一命令、选区或受影响元素不变量失败都会应用 inverse 整体回滚。
- 选区覆盖元素、组内、文本与表格；文本位置按段落/run/UTF-16 偏移校验。撤销/重做同时恢复选区，
  `markSaved` / `isDirty` 用状态 token 判断是否回到保存点，公开历史不泄漏内部 token。
- 历史默认 200 组 / 8MB。同页、同路径、同 `mergeKey` 且间隔不超过 500ms 才合并；跨页、选择、
  保存、undo/redo 与非记录写入都会断组。远端或 `recordHistory:false` 写入会按 patch 路径 rebase
  undo/redo：冲突旧路径剔除，非冲突字段仍可撤销，状态 token 链同步重建，因而不会覆盖远端值。
- 会话入口验证全局模型，提交边界只重验 patch 影响元素与父链，成本与改动规模而非文档规模相关。
  同时修正两个溯源根因：母版/版式投影不在普通页视图中可写；畸形重复 `part + spid` 锚点降级只读。
- 新增确定性 `sample-edit-basic.pptx`（2 页；shape / image / group / table / unsupported frame），
  两次生成 SHA-256 均为 `4ecfbef6d2ec2ee7ee3c1b38a3b27fcac99127b6166980b0ec23509bed400fdb`。
- 固定种子 200 条合法命令验证完整撤销、重做和 JSON patch 回放全等；500 条非法命令全部拒绝。
  临时把真实 `set-xfrm.ts` 的 override 探测变异为恒真后，测试以非法 inverse 退出 1，随后恢复源码。
- 210 页 / 12,810 元素基准：200 组 undo / redo 含脏页重渲分别 `0.516 / 0.530ms` 每次，
  历史 `63.7KB`；200 组历史上的 1,000 次远端 rebase 为 `0.061ms` 每次；编辑驻留内存 `+6.9%`。
  默认入口构建实测 `8.28KB gzip`。
- 最终门禁：`npm run check`、`npm test`、`npm run build` 全部通过；双轴代码审查无残留。
