---
title: 补齐内容流转、文档导出与格式保真
status: open
labels:
  - wayfinder:map
tracker: local-markdown
---

## Destination

按已讨论的可行范围，补齐高级文本保存/复制、复杂图表编辑、矢量 PDF 与带音轨视频；以真实样本界定并逐项扩展
SmartArt/OLE、高级渲染和旧 PPT。每项交付都有明确支持矩阵、公开入口、官网操作与独立验证。

按用户“完成下一阶段的需求”开始执行。规划基线为 `45a04a7`，已交付范围见[扩展能力矩阵](../../expanded-capabilities.md)。

## Notes

- 优先级、依赖及共同完成条件见[下一阶段执行计划](plan.md)，领域词汇沿用 [CONTEXT.md](../../../CONTEXT.md)。
- `Presentation` 是展示模型，`EditDoc` 承担编辑语义；生成保存不能用展示模型中已经丢失的信息伪造原生内容。
- 沿用纯浏览器、fflate 唯一核心运行时依赖、无框架主包、两条文本路径与 Worker 约束；新增能力按需加载。
- Windows PowerPoint 真机按用户要求继续暂缓，不能记为通过；研发地图不因版本打包而关闭；用户于 2026-09-09 单独要求按模块提交、推送并打包 beta.5，见[交付说明](../../releases/0.5.0-beta.5.md)。
- `tickets/*.md` 是本地子票。`status: open`、未分配 `assignee`、`blocked_by` 全部关闭的票处于前沿；按 `priority`
  和文件顺序选择。开始工作先认领，完成时记录 Answer、证据和状态，再在下方加入标题链接。
- 一次会话最多解决一张票；研究/原型票关闭只证明路线成立，须为确定的实现范围新建子票并补依赖，不能据此关闭地图。
- 如需工程技能，按问题选择 implement、diagnosing-bugs 或 prototype；不因现有验证不足放宽预算或制造成功记录。

## Decisions so far

- 已完成[高级文本生成保存与复制](tickets/001-portable-rich-text.md)：797 项专项、两条文字路径、官网中英文流转和独立读取器验证已记录。
- 已完成[经典图表多级类别编辑](tickets/002-chart-hierarchical-categories.md)：178 项专项、原生层级与工作簿同步、历史/协同及独立读取器边界已记录。
- 已完成[共享工作簿同步](tickets/003-shared-chart-workbook.md)：共享数据、历史、恢复、协同和保存闭环通过。源码与发布包各 2,320 项共享断言、45 组迁移和 406 对 SVG；两份复核、四项门禁、最终浏览器成本与 12 份外部图像对照已完成。混合图外观差异及大文稿长尾按实测公开，外观后续登记到 009；见[支持范围与证据](shared-chart-progress.md)。
- 已完成[字体与字形原型](tickets/004-font-glyph-provider.md)：显式字节、可注入 HarfBuzz 与独占 Worker 路线可行；两份 PDF 的 29 个字形与原文经独立读取验证，6 次 Worker 退出及四项门禁通过。边界与实际成本见[原型结论](font-glyph-prototype.md)。正式工程实现由 [011](tickets/011-font-glyph-implementation.md) 承接。
- 已完成[正式字体与字形 Provider](tickets/011-font-glyph-implementation.md)：独立入口、权限与输入预算、可取消 Worker、两条文字路径测量及 Cordis 字体工具通过验收。真实 tarball、完整中英文站点、36 字形独立证明、完整中文字体成本和四项门禁齐全；真实 MTX 的非法输出与 900 字重绑定限制按实测公开，见[验收记录](font-glyph-implementation.md)。
- [005 矢量 PDF](tickets/005-vector-pdf.md)功能验收已齐：可搜索普通文字、矢量图形、对象级回退、方言审计、Poppler/pypdf 交叉阅读、长文稿成本与 Cordis/官网产品入口；图案阅读器栅格差异保留。待全仓四项门禁复验后改 closed。证据见[实现进度](vector-pdf-implementation.md)。
- 已完成[旧 PPT 外观写入](tickets/012-legacy-ppt-appearance-write.md)：双色线性渐变、图案、矩形裁剪、预设虚线与默认箭头的 `savePpt` 往返与 LibreOffice 无修复重开；原子拒绝项见票。调查票 [010](tickets/010-legacy-ppt-scope.md) 已关。
- 已完成[SmartArt matrix1/radial1](tickets/013-smartart-matrix-radial.md)：确定性固件与编辑/重排契约见票。
- 已完成[视频音轨](tickets/006-video-audio-track.md)：PCM WAV→Opus、双页延迟混音、FFmpeg 脉冲同轴、官网拒绝项文案与取消证据；未建模播放属性显式拒绝。
- 已完成[内嵌视频合成](tickets/007-video-media-composition.md)：H.264/AAC、静态 xfrm、显式 loop/crossSlide、官网媒体导出；timing 勾选与动画位移显式拒绝。
- 用户再次指出的产品外壳 Cordis 方案已补齐[文稿、打开、新建、恢复、文件、业务工具与页面服务](../../cordis-editor.md)，视口、模式、导航、历史按钮和页面状态由同一应用持有，发布 SDK 保持无框架。页面生命周期专项、双轴复审及三张生产页面完整中英文回归通过；首次性能失败经隔离复测后，最终四项仓库门禁按原预算全部通过。此项补回原约定，不替代本地图 001–010 的范围。

## Not yet specified

- 字体首版容器、语言和按需方式已由 004 确定，正式工程实现由 011 承接；复杂脚本、变量字体、CFF 与 WOFF 解压的后续支持方式尚未确定。
- SmartArt matrix/radial 与旧 PPT 外观首批已由 013/012 关闭；OLE 与 EMF+/混合图见 014–016。艺术字/三维等其余高级渲染边界仍待 009/016。
- 高级文本与多级类别入口已记录冷加载、耗时和内存采样；其他入口及浏览器峰值内存仍待实测，不预填虚构工期或收益数字。
- 发布版本和 API 冻结时机仍由 beta 反馈及外部验收决定，不因计划建立而提前承诺。

## Out of scope

- 任意 OLE 宿主应用的完整原位编辑、宏、AI 生成、模板市场及服务端转换。
- 从缺失字体、缺失媒体或已丢失语义中恢复不存在的数据；不支持的输入必须给出可定位原因。
- 保证所有浏览器支持所有编解码器，或保证所有文件与 PowerPoint 逐像素相同。
- 将 PPTX 独有对象伪装成可编辑旧 PPT 对象；未知二进制记录的完整保留不随增量写入能力默认承诺。
