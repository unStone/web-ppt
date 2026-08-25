---
title: 发布 React 与 Vue 查看编辑适配包
status: done
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./014-editor-session-static-view.md
  - ./053-change-slide-layout.md
  - ./054-edit-speaker-notes.md
---

## Question

如何把已经稳定的无框架查看与编辑 seam 封装成可单独安装的 React 和 Vue 发布包，让用户用组件、hook/composable 和受控属性完成文件打开、view/edit 模式、当前页、缩放、订阅、保存与销毁，而不复制渲染、状态机或编辑领域逻辑？

至少交付 `@web-ppt/react` 与 `@web-ppt/vue` 两个薄包：框架依赖只能是各自的 optional peer，`core`、`viewer-core`、`edit-core`、`editor` 不得新增框架运行时。两包共享同一份框架无关 adapter contract，组件只管理挂载容器和生命周期；页面导航、选择、命令、查询、保存、错误与进度通过稳定受控属性和事件暴露。view 与 edit 必须共用公开预览链路，不能维护第二份 Slide/DOM；产品工具栏、设计系统和业务状态不进入包内。

入口在 SSR/Node 导入时不能访问 `window` 或 `document`；React StrictMode、Vue 重挂载、文件替换、多视图、模式切换、并发打开取消和卸载都必须精确释放 session、Blob URL、监听器与输入焦点。宿主可选择由适配器拥有 session，或注入已有 session 供多个框架视图共享；所有权必须显式，避免双重 dispose。TypeScript 类型从基础包复用，不复制命令联合类型。

用当前主流 React/Vue 正式版本建立真实浏览器契约和最小示例，验证同一 PPT 的查看、编辑、撤销、保存下载、只读拒绝、两视图同步与卸载无泄漏；分别构建 ESM 与声明文件，排除框架后每个适配包 gzip 目标小于 5KB。README 给出各自最短接入代码和从无框架 API 迁移的对应表；Web Component、Svelte 和其它框架以同一 adapter contract 的参考实现或文档证明可接入，不为每个生态复制核心逻辑。

## Outcome

- `@web-ppt/editor` 新增唯一的框架无关 adapter contract；`source` 会话归 adapter 所有，注入会话必须显式声明 `external`。文件替换先挂新视图再释放旧资源；过期并发打开、失败回退、同外部会话恢复、重复销毁与宿主回调异常均有回归契约。
- `@web-ppt/react` 交付 `WebPptEditor`、`useWebPptAdapter` 与类型化 handle；`@web-ppt/vue` 交付同名组件、composable 与 handle。两包只含容器/生命周期映射，React/Vue 均为 optional peer，四个基础包没有框架运行时。
- Node SSR 与真实 Chromium 已用 React `19.2.8`、Vue `3.5.41` 验证 StrictMode、重挂载、受控页/缩放/模式、文件替换、跨框架双视图、只读拒绝、编辑/撤销/保存、Blob 下载及 URL 回收。独立评审发现的生命周期、错误传播与异常隔离问题均已固化为测试，双审最终均为 `0 remaining`。
- 生产构建实测 `editor/react/vue` 分别为 `40.61KB / 0.92KB / 1.16KB` gzip；排除框架与 editor peer 后为 `787B / 972B` gzip。`npm pack --dry-run` 得到完整 ESM、声明、README、LICENSE 与 CHANGELOG，tarball 为 `14.2KB / 15.0KB`。
- 七包版本、构建与依赖顺序已进入 release workflow；缺少首次发布引导时会在耗时测试前明确失败。2026-08-26 registry 实查仍缺 `edit-core/editor/react/vue`，公开首发与逐包 Trusted Publishing 配置属于维护者授权动作，未在本任务中擅自执行。
- 精确执行 `npm run check && npm test && npm run build`：core 2131、edit-core 741、保存 307、PowerPoint 证据 9、editor 306、adapter 8、metafile 130 全绿；61 份固件 / 186 页 / 372 对 SVG 指纹与 176 个快照一致，七个发布包构建成功。
