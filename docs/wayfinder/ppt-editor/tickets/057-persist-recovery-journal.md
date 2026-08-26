---
title: 持久化恢复日志并提供恢复决策
status: done
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./056-recovery-journal-primitives.md
---

## Question

如何把 `@web-ppt/edit-core` 已公开的恢复帧接入纯浏览器持久化，使用户重新打开同一份源文件时能在任何画布可见前选择恢复或放弃，同时不让 headless 包依赖 IndexedDB，也不让框架组件复制恢复生命周期？

源身份必须按文件内容计算稳定 SHA-256，而不是依赖文件名、大小或 `lastModified`；未启用恢复时不得读取第二遍源文件或引入指纹开销。恢复记录必须同时保存 `idPrefix`、源字节数、严格有序帧、首末更新时间和尾帧 dirty 状态，同字节的 `File` / `Blob` / `ArrayBuffer` / `Uint8Array` 必须命中同一日志，不同内容即使同名也不得串档。

`@web-ppt/editor` 公开可替换的 `RecoveryStore` seam 与 IndexedDB 实现。追加采用串行批量事务，编辑提交不能等待磁盘；`flush()` 可等待已排队写入并报告持久化失败。达到阈值时把逐次记录重组为保留帧边界的分块，并只合并连续、无模型变化的选择/保存点元数据帧；按最大记录数、总估算字节和保留天数清理最旧的非当前日志。任一追加、压缩、清理或 quota 错误都不能撤销已生效编辑，也不能产生未处理 Promise rejection。

`openEditor({ recovery })` 是唯一会话入口：先对调用方可变字节做私有快照，再计算指纹并读取候选；`restore` 使用记录中的 `idPrefix` 和帧，`discard` 原子换成空的新代际占位，旧会话的晚到追加必须失败，`cancel` 不解析、不挂载且不改旧日志。没有候选时直接占位并打开。恢复后的新帧继续追加同一日志；正常保存后仍保留从原始源到当前状态的完整链，只有尾帧 clean 时不提示，后续编辑再次变 dirty 后仍可完整恢复。

框架 adapter 只把同一流程映射为 `recovering` 状态、候选快照和 `onRecovery` 决策回调；每次打开持有独立取消信号，换文件后过期占位与持久化错误都不能污染最新会话。React/Vue 类型自然透传，不建立框架私有存储。外部 session 不被 adapter 擅自持久化。默认能力必须显式启用，SSR/Worker 导入不能访问 `window`、`document` 或 `indexedDB`。

用公共 seam 的确定性内存 store 覆盖指纹、恢复/放弃/取消、并发打开失效、错误隔离、保存后再编辑和压缩等价；再用真实 Chromium IndexedDB 覆盖页面重开、批量追加、升级/清理与 1,000 帧恢复。50MB 源指纹只做一次；单帧提交同步附加开销目标小于 0.5ms，1,000 帧持久化与读取各小于 500ms，压缩后记录数不超过配置阈值。

## Resolution

- `@web-ppt/editor` 公开完整字节 SHA-256 源身份、可替换 `RecoveryStore`、按需
  `createIndexedDbRecoveryStore()` 与 `EditorSession.recovery`。未启用时不读取源快照或计算指纹；启用后
  `File` / `Blob` / `ArrayBuffer` / `Uint8Array` 先复制为一份私有字节，指纹与解析共用它，调用方在决策
  期间修改或 transfer 原缓冲区也不会分裂身份与内容。
- 编辑事务只同步进入内存队列，microtask 批量串行追加，`flush()` 提供显式持久化边界。IndexedDB 普通
  append 只校验日志尾部，超过阈值才全链验真并重分块；Patch 帧原样保留，只合并连续无模型变化的元数据
  帧。日志数、估算字节与保留期按当前日志保护策略清理，时钟回拨仍维持更新时间单调。
- `restore` 在挂载前复用日志 `idPrefix` 和帧；`discard` / clean 尾帧通过 `epoch + reset` 原子换代，旧页面
  的晚到追加只能失败，不能复活旧内容。取消信号贯穿候选决策和占位事务，同内容并发打开、换文件、宿主
  abort 后立即重试与迟到决策均只允许最新会话提交。
- 框架无关 adapter 公开 `recovering`、轻量候选和 `onRecovery`；React/Vue 只透传同一生命周期与错误事件。
  自动保存失败不回滚编辑，进入 `session.recovery.error`、`flush()` rejection 和当前已提交 session 的
  `onError`；旧会话迟到错误、已销毁 adapter 与过期 Promise 均被代际隔离。SSR 与真实 Worker 导入不访问
  DOM 或 IndexedDB 全局。
- 确定性内存 seam 与真实 Chromium 覆盖恢复、放弃、取消、clean/savepoint、坏序号原子拒绝、压缩后
  模型/选区/dirty 等价、关闭重开、时钟回拨、容量/保留期清理及错误隔离。真实 Chrome 实测 50MB 指纹
  42.2ms，1,000 帧持久化/关闭重开恢复 131.5/14.9ms，压缩后 10 个分块，同步提交 p95 增量 0.000ms；
  均低于票据预算。两路独立最终审查均为 0 findings。
