---
title: 保留可编辑解析溯源与原包生命周期
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by: []
---

## Question

如何以完全 opt-in 的 `parse({ edit: true, keepPackage: true })` 契约保留元素回写锚点、占位符身份和原包句柄，同时保证只读解析的模型、内存与 `dispose()` 语义不变？

## Resolution

答案是把“编辑溯源”和“持有原包”拆成两个互不隐式联动的 opt-in 开关：

- `parse(bytes, { edit: true })` 只给幻灯片与元素附加 `editInfo`。元素锚点保留源 part、`spid` 和占位符 `type` / `idx`，可供后续命令、XML patch 与布局继承使用；默认解析结果没有这些字段。
- `parse(bytes, { keepPackage: true })` 只返回只读 `OpcPackage`。它零拷贝持有调用方传入的 ZIP 字节，按 part 暴露解包内容；`dispose()` 会清空源字节、parts 与解析缓存，重复调用安全。默认解析不保留原包，也不会增加常驻内存。
- 两个开关可独立或组合使用；`.ppt` 不伪造 OPC 包或 OOXML 溯源。现有 SVG 预览链路、默认图表命名和渲染快照均保持不变。

改动集中在 `packages/core/src/types.ts`、`packages/core/src/index.ts`、`packages/core/src/pptx/parser.ts` 与 `tooling/test-core.mjs`。测试遍历全部 13 个 `.pptx` 固件，验证每个可识别元素的 `spid` 与源 part、占位符身份、四种开关组合、零拷贝字节、parts 可用性及销毁语义。

验证证据：`npm run check`、`npm test`（core 1902、metafile 130、162 个快照）和 `npm run build` 全部通过；210 页 / 12810 元素基准解析 37ms、渲染 46ms，默认路径常驻内存仍为 630MB；`@web-ppt/core` 的 `npm pack --dry-run` 通过，声明文件包含新契约。
