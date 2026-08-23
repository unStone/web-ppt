---
title: 建立编辑会话与三层静态视图
status: open
labels:
  - wayfinder:task
parent: ../map.md
assignee:
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

<!-- 完成时记录公共接口、DOM 分区策略、资源所有权、性能与全仓验证。 -->
