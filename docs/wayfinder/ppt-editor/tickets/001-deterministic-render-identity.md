---
title: 建立确定性渲染身份
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by: []
---

## Question

如何在不改变现有默认行为和同页多 SVG 防冲突语义的前提下，引入显式 `idPrefix`，让同一编辑投影可稳定重渲、比较和做元素级更新？

## Resolution

`renderSlideToSvg` 的 ID 分配器已下沉到单次渲染 `Ctx`：

- 省略 `idPrefix` 时仍调用原全局计数器，同一页多次渲染的 defs id 不重叠，现有查看器语义不变。
- 指定 `idPrefix` 时使用每次渲染从 1 开始的局部计数器；同一页与同一前缀逐字节相同，不同前缀可同时挂载。
- 前缀中的非安全码点采用无歧义编码，不把公开 API 字符串直接拼进 SVG，恶意输入不能破坏 XML 或注入标签。
- `RenderOptions` 已从 `@web-ppt/core` 包根导出；中英文 README 与未发布日志给出编辑器用法，prepack 后进入 npm tarball。

改动集中在 `packages/core/src/render/svg.ts`、`packages/core/src/index.ts` 和对应测试/文档，没有改变 Schema、解析器或两条文本路径。

验证证据：

- `npm run check` 通过。
- `npm test` 通过：core 1879 项断言、162 个快照全部一致；metafile 130 项断言通过。
- `npm run build` 通过：core、viewer-core、fonts 三包均成功构建；core 为 85.99KB gzip。
- `npm run bench`：210 页/12810 元素全部渲染 41ms；ID 分配复杂度仍为 O(defs 数)，显式前缀只在每页开始编码一次。
- `env npm_config_cache=/private/tmp/web-ppt-npm-cache npm pack --dry-run --json -w @web-ppt/core` 通过，tarball 51 个文件且包含新的声明与同步文档。
