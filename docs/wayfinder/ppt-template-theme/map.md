---
title: 完成 0.7 模板与主题编辑
status: open
labels:
  - wayfinder:map
tracker: local-markdown
---

## Destination

让用户在浏览器内从设计来源而不是逐元素直设来定制整份演示文稿：可编辑主题、版式与母版，可从多套内置模板
新建文稿；任一来源变化都只传播到真正依赖它的页面，同时保留页面和元素的直接覆盖。全部能力通过公开无框架
接口、历史、恢复、协同、补丁保存与生成保存交付，默认查看和打开既有文件的路径不加载内置模板数据。本地图达到
可发版状态即完成，不包含 tag、推送或 npm 发布。

## Notes

- 领域词汇见 [CONTEXT.md](../../../CONTEXT.md)，范围与收益排序见[能力盘点与演进路线](../../roadmap.md)，
  现有编辑基础设施见[纯 Web PPT 编辑能力](../ppt-editor/map.md)与
  [0.6 高频编辑能力](../ppt-editing-completeness/map.md)。
- 设计来源只有一张有向图：`Theme → Master → Layout → Slide`。子级只保留自己的 Source Value 与 Override，
  禁止把父级求值结果复制成新的真值；页面直设始终压过继承来源。
- OPC part 是来源身份；会话内元素仍使用稳定逻辑身份。反向依赖索引从资源图建立，并在换版式、新增页、删除页时
  增量维护，不能在每次提交时扫描全包，也不能用数组下标寻址。
- 对外 seam 保持小：调用方只学习资源目录、查询状态、纯数据命令和设计画布入口；OOXML 覆盖重解析、占位符重绑、
  缓存失效与保存闭包都藏在对应深模块内，测试也只从同一 seam 观察行为。
- `render/` 不感知主题、版式或母版编辑，仍只依赖 `types.ts`；`core` 不碰 DOM。编辑解析新增的语义元数据只能在
  `edit: true` 时存在，未启用编辑的解析/渲染路径不得增加常驻模型。
- “内置模板”是按需生成的确定性主题 + 母版 + 版式配方，不是远程模板市场，不含字体字节、网络资源、AI 生成或
  一批难以维护的固定 `.pptx` 二进制；`createBlankPptx()` 继续兼容现有最小模板。
- 每张实现票必须同时覆盖确定性固件、模型不变量、撤销重做、恢复/协同、补丁与生成保存、独立进程两条文本路径
  指纹、LibreOffice ground truth、真实 Chrome 和公开类型契约。Windows PowerPoint 只登记可复验工件，不伪造
  当前环境没有的成功报告。
- 完成代码改动后必须运行 `npm run check && npm test && npm run build && npm run verify`，且不放宽现有性能和
  默认入口体积预算。
- 本地 Markdown 票据以 `tickets/*.md` 表示；`status: open`、无 `assignee` 且 `blocked_by` 全部关闭的票据位于
  前沿。一次会话最多关闭一张票，开始实现前先写 `assignee: /root`。

## Decisions so far

- [主题编辑闭环](tickets/001-theme-editing.md)是唯一首个前沿：先证明资源图、继承重算和全文档传播，再让版式、
  母版复用同一失效机制。
- [版式编辑](tickets/002-layout-editing.md)已建立“设计画布”接口与增量依赖失效；
  [母版编辑](tickets/003-master-editing.md)复用这条 seam，页面、版式和母版仍是不同领域对象，调用方不能靠伪造
  SlideId 复用命令。
- [内置模板](tickets/004-builtin-templates.md)复用生成保存模块的结构配方；模板目录和数据只从独立按需入口加载。
- [0.7 集成验收](tickets/005-v07-integration-readiness.md)在四条能力全部关闭后统一证明产品入口、包边界和文档一致。

## Frontier

- [把母版与文字默认值作为设计画布编辑](tickets/003-master-editing.md)

## Later

- [提供按需确定性内置模板](tickets/004-builtin-templates.md) — 被主题、版式与母版编辑阻塞。
- [完成 0.7 集成验收](tickets/005-v07-integration-readiness.md) — 被全部能力票阻塞。

## Completed

- [编辑主题并传播到依赖页面](tickets/001-theme-editing.md) — 主题目录、继承传播、最小保存、协同和多环境证据闭环。
- [把版式作为设计画布编辑](tickets/002-layout-editing.md) — 稳定设计画布、继承重绑、保存与跨环境证据闭环。

## Not yet specified

- 0.8 的图表数据、chartex、媒体插入与官网 i18n 仍按[总路线图](../../roadmap.md)后置；本地图不提前扩张。
- 多主题/多母版文稿必须保留并可编辑已有资源，但 0.7 不新增或删除主题、母版、版式，也不跨文稿复制整套设计。
  这些结构命令只有在真实产品场景证明必要后再单独建图。

## Out of scope

- 模板市场、远程素材、AI 生成、服务端转换与宏逻辑。
- `.ppt` 二进制母版写回；二进制输入继续明确另存为 `.pptx`，由生成保存承接有效结果。
- 备注母版、讲义母版及审阅工作流；它们不在普通放映页面的设计继承链上。
- 直接编辑主题的格式样式矩阵（`fmtScheme`）与颜色映射（`clrMap` / `clrMapOvr`）；0.7 保留其未知 XML，先交付
  路线图明确的 `clrScheme`、`fontScheme`、版式、母版与 `p:txStyles`。
