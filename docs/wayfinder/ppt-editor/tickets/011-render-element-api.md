---
title: 公开元素级增量 SVG 渲染
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./005-prove-m0-equivalence.md
---

## Question

如何从现有页面渲染器提取 `renderElementToSvg`，返回可独立替换的 markup 与 defs，同时保持嵌入字体、滤镜/裁剪 id、组递归、两条文本路径和整页 SVG 逐字节一致，并让编辑提交只重渲脏元素？

## Resolution

答案是在 `@web-ppt/core` 公开 `renderElementToSvg(element, options) → { markup, defs }`，并让它与 `renderSlideToSvg` 共用同一个上下文构造器和唯一的 `renderEl` 分派，而不是另写一套编辑渲染器：

- `RenderElementOptions` 只包含元素真正需要的 `idPrefix`、`textMode`、`hiddenElements` 与 `media`；页面级的备注、批注和嵌入字体仍由整页入口管理。`markup` 不带根 `<svg>`，`defs` 只包含该元素本次引用的局部定义，编辑器应为每个同时挂载的元素使用稳定且互不相同的前缀，并在一次 DOM 提交中一起替换节点与 defs 分区。
- 显式 `idPrefix` 会创建本次调用内的局部计数器，因此同一元素重复渲染逐字节稳定，不同元素不会发生滤镜、裁剪、渐变 id 冲突；省略前缀时仍保留原有跨渲染全局唯一语义。组节点继续递归应用动画隐藏集，HTML 模式可输出真实媒体播放器，原生 SVG 文本模式强制退回可移植 badge，单元素异常仍由原有错误占位隔离。
- 整页渲染只把原上下文初始化收敛为 `createCtx`，元素分派、两条文本路径、滤镜/裁剪和媒体逻辑没有复制。全部 162 个快照保持不变；22 份固件、97 页、194 对只读/编辑原始 SVG 指纹也完全一致。
- 元素契约遍历全部现有固件的顶层元素和两种文本模式，共 2162 个组合，覆盖 shape、image、group、table、unsupported；逐项验证 `{ markup, defs }` 可原样组成单元素页面、XML 合法、无悬空 defs 引用，并补充稳定/隔离前缀、递归隐藏、媒体降级、错误隔离及无 `document` 运行测试。

性能门禁现在测真实链路 `override → invalidateElement → effectiveElement → renderElementToSvg → DOM 分区替换`。210 页 / 12810 元素下，脏元素提交并渲染为 0.013ms/次，连同 DOM 替换为 0.091ms/次（预算分别为 8ms、16ms）；整页提交重渲为 0.452ms/次，编辑常驻内存增量 +0.7%。这证明接口具备增量更新所需的计算边界，但 DOM 编辑器仍需在后续任务中实现元素/defs 分区的生命周期。

发布面验证：构建后的 ESM 与声明文件均导出新 API，`npm pack --dry-run` 包含实现、类型和文档，共 51 个文件、186240 字节；`core.js` 为 86.14KB gzip，相对改动前约 +0.05KB。`npm run check && npm test && npm run build` 全绿（core 1929、edit-core 42、metafile 130、162 个快照、194 对编辑等价指纹），`npm run bench:edit` 通过全部预算。
