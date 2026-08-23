---
title: 建立编辑会话与三层静态视图
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./004-edit-doc-projection.md
  - ./008-command-patch-history.md
  - ./009-set-xfrm-ooxml-patch.md
  - ./011-render-element-api.md
---

## Question

如何交付可发布、零框架运行时的 `@web-ppt/editor` 第一条垂直切片，使调用方只需打开一次文件就获得资源所有权明确的编辑会话，并可把同一会话挂载为查看或编辑模式的 `SlideEditor`？

公共 seam 必须隐藏 `Presentation`、`EditDoc`、`Editor` 的装配与释放细节，同时保留 headless `Editor` 给工具栏调用；`SlideEditor` 负责静态 SVG、交互 SVG、文本 HTML 三层 DOM，以及 `setSlide`、`setMode`、`setZoom`、`destroy` 生命周期。事务提交后应按 `dirtyElements` 做元素级 markup/defs 原子替换，脏顶层元素超过本页 30% 或只有页级失效时才整页重渲；未修改兄弟的 DOM 节点身份必须保持不变。

验收通过公开 seam 和实际 DOM 观察：两种模式共享同一高保真投影；嵌入字体与资源仍来自源 Presentation；嵌套组命中节点带稳定 EditDoc 身份；销毁视图会退订但不误释放共享会话，销毁会话会释放原包与 blob URL；60 元素单元素提交到 DOM 不超过 16ms。`core`、`edit-core` 不得新增 DOM 依赖，包内不得引入 React、Vue 或其它 UI 框架。

## Resolution

- 新增可单独发布的 `@web-ppt/editor`。唯一运行时创建入口 `openEditor(input, options)` 隐藏
  `Presentation → EditDoc → Editor` 装配，只公开 `EditorSession` / `SlideEditor` 接口和 headless
  `session.editor`；React、Vue、Svelte 与原生 DOM 适配器可共用同一 seam，包内没有 UI 框架依赖。
- `SlideEditor` 管理静态 SVG、交互 SVG、文本 HTML 三层，公开 `setSlide`、`setMode`、
  `setZoom`、`destroy`。查看/编辑模式不重建静态预览；`textMode:auto` 复用 viewer-core 的
  WebKit 运行时探测，整页和增量更新始终使用同一文本路径。
- `EditorChange.touchedElements` 区分真正被 patch 的元素与 `dirtyElements` 中的投影缓存祖先。
  DOM 按稳定 `data-edit-id` 替换精确元素；嵌套组内叶子更新保留组容器与外部兄弟，脏顶层
  owner 超过本页 30% 或只有页级失效时才整页重渲。
- 元素 markup 与 defs 在一次同步提交中换代。首次更新会从旧 markup 的引用出发递归清理
  defs 依赖闭包；倒影 `mask → linearGradient` 回归证明旧定义断连、重复提交不增长，页面级
  嵌入字体不受影响。
- 会话统一拥有原包、Presentation 资源与全部视图；视图销毁只退订自己，会话销毁会清理剩余
  视图、ZIP 字节和 blob URL，挂载失败也不会遗留 DOM 或订阅。60 元素确定性固件两次生成
  SHA-256 均为 `2f7e8c7686d3cf6881f98c74c9f4e90927ccfa7506051c19c80db8e51a264de4`。
- 真实 Chrome 通过公开 seam 验证 blob 图片、3 个嵌入 `@font-face`、兄弟节点身份与 60 元素
  单元素提交，最终 p95 为 `0.100ms`（预算 16ms）；jsdom 17 项断言全绿。发布构建为
  `3.13KB gzip`，dry-run tarball 为 15.2KB / 11 文件。
- 最终 `npm run check`、`npm test`、`npm run build` 顺序全绿：core 1987、edit-core 244、
  M1 11、editor 17、metafile 130 项断言，162 个快照与 26 份固件 / 104 页 / 208 对独立
  进程 SVG 指纹一致；`npm run bench:edit` 的全部性能和零状态预算通过。Spec 与 Standards
  双轴复审均无残留。
