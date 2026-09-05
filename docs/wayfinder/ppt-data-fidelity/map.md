---
title: 完成 0.8 数据与保真
status: open
labels:
  - wayfinder:map
tracker: local-markdown
---

## Destination

让 Web-PPT 0.8 能在浏览器内安全编辑经典图表数据、解析并原生渲染除地图外的现代扩展图表、插入可交付的
音视频，并让官网完整支持中英文；每项能力都沿用统一 Schema、历史、恢复、协同和两种保存路径，默认查看及
未使用能力不承担新增代码、模型或网络成本。完成态是仓库达到可发版状态，不包含 tag、推送或 npm 发布。

## Notes

- 领域词汇见 [CONTEXT.md](../../../CONTEXT.md)，优先级和已确认取舍见[能力盘点与演进路线](../../roadmap.md)，
  编辑基础设施与设计来源分别见[纯 Web PPT 编辑能力](../ppt-editor/map.md)和
  [0.7 模板与主题编辑](../ppt-template-theme/map.md)。
- 图表数据集只有一份语义真值；`c:numCache` / `c:strCache` 与内嵌 `.xlsx` 是同一次保存展开出的两个投影，
  不能成为可分别修改的状态。范围是系列、类别和数值的增删改，不切换图表类型。
- 图表数据和扩展图表解析使用独立按需入口。`render/` 仍只依赖 `types.ts`，`core` 不依赖 DOM；未调用
  0.8 入口时，默认 core / edit-core / editor 初始依赖图、常驻模型与包体积不得增长。
- `cx:chartSpace` 与经典 `c:chartSpace` 分属两条输入链路，最终只汇入统一 Schema。树状图、旭日、直方图 /
  Pareto、箱线、瀑布和漏斗原生渲染；`regionMap` 永久走 Office 自带 fallback，不下载或内置行政区边界。
- 媒体插入必须区分媒体字节、海报图和外部链接，复用现有关系/资源闭包；保存结果在无网络环境仍能播放的，
  才能标为嵌入媒体。官网国际化只负责产品文案，不把文案带进无框架发布包。
- 每张实现票同步补确定性固件与真实语料证据，并覆盖模型不变量、撤销重做、恢复/协同、补丁/生成保存、
  独立进程渲染指纹、LibreOffice ground truth、真实 Chrome 和公开类型契约。Windows PowerPoint 只登记
  当前提交绑定的可复验工件，不伪造本机没有的成功报告。
- 完成代码后运行 `npm run check && npm test && npm run build && npm run verify`；不放宽现有性能、体积或
  确定性预算。
- 本地 Markdown 票据以 `tickets/*.md` 表示；`status: open`、无 `assignee` 且 `blocked_by` 全部关闭的票据
  位于前沿。一次会话最多关闭一张票，开始实现前先写 `assignee: /root`。

## Decisions so far

<!-- 已关闭票据只在这里留一句索引；详细答案只写进对应票据。 -->

- [经典图表数据编辑](tickets/001-chart-data-editing.md)已关闭：按需数据模型、缓存/工作簿原子保存及最终四项门禁通过。
- [兼容回退与整壳编辑](tickets/008-alternate-content-fallback.md)已关闭：197 项专项、分组/解组复制与恢复、两条保存及 LibreOffice 验收通过，最终四项门禁全绿。

## In progress

- [确认扩展图表回退与真实语料边界](tickets/002-chartex-fallback-corpus.md)已补真实漏斗的 Chrome/独立 SVG
  视觉证据和 9 个源文件的数据引用取证；其他类型原始 PPTX、层级空槽规则与原生布局仍缺证。

## Frontier

- [插入可交付的音视频](tickets/005-media-insertion.md)
- [让官网完整支持中英文](tickets/006-site-i18n.md)

## Not yet specified

- 图片透明度、灰度与双色调写回（`SetPictureFx`）、形状 3D 写回（`SetScene3D`）、File System Access 双路径、
  画布 AT 语义与 EditContext 渐进增强仍是总路线图中的开放缺口；0.8 集成验收时按用户收益、默认成本和
  真实语料重新判断进入后续地图的顺序，不在本地图中静默宣称完成。
- 1.0 的 API 冻结、迁移提示、语料回归和 beta 反馈周期只有在 0.8 公开面稳定后才能精确拆票。

## Out of scope

- `regionMap` 原生渲染：行政区边界数据会把数 MB 成本落到用户头上，按需下载又破坏文件不出本机的边界；
  保留并验证 Office fallback。
- 图表类型切换、格式样式编辑、趋势线/误差线编辑和公式计算引擎；0.8 只编辑已有经典图表的数据集。
- `.ppt` 图表/媒体二进制写回、SmartArt/OLE/墨迹内部编辑、宏、模板市场、AI 生成和服务端转换。
- 创建 tag、推送、npm 发布与 dist-tag 变更；这些都是需要另行授权的外部发布动作。
