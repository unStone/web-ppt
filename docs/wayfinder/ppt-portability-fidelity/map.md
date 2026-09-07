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
- Windows PowerPoint 真机按用户要求继续暂缓，不能记为通过；本计划不分配版本号，不包含 tag 或 npm 发布。
- `tickets/*.md` 是本地子票。`status: open`、未分配 `assignee`、`blocked_by` 全部关闭的票处于前沿；按 `priority`
  和文件顺序选择。开始工作先认领，完成时记录 Answer、证据和状态，再在下方加入标题链接。
- 一次会话最多解决一张票；研究/原型票关闭只证明路线成立，须为确定的实现范围新建子票并补依赖，不能据此关闭地图。
- 如需工程技能，按问题选择 implement、diagnosing-bugs 或 prototype；不因现有验证不足放宽预算或制造成功记录。

## Decisions so far

- 已完成[高级文本生成保存与复制](tickets/001-portable-rich-text.md)：797 项专项、两条文字路径、官网中英文流转和独立读取器验证已记录。
- 已完成[经典图表多级类别编辑](tickets/002-chart-hierarchical-categories.md)：178 项专项、原生层级与工作簿同步、历史/协同及独立读取器边界已记录。
- 下一张前沿票为[共享工作簿同步](tickets/003-shared-chart-workbook.md)。其余票保持待办，地图尚未完成。

## Not yet specified

- 字体原型将确定可支持的字体容器、字形整形范围及按需实现方式；超出首批范围的支持方式尚未确定。
- SmartArt/OLE、EMF+/艺术字/三维和旧 PPT 的首批真实样本及边界正在等待对应调查票；其具体实现票在调查收口后创建。
- 高级文本与多级类别入口已记录冷加载、耗时和内存采样；其他入口及浏览器峰值内存仍待实测，不预填虚构工期或收益数字。
- 发布版本和 API 冻结时机仍由 beta 反馈及外部验收决定，不因计划建立而提前承诺。

## Out of scope

- 任意 OLE 宿主应用的完整原位编辑、宏、AI 生成、模板市场及服务端转换。
- 从缺失字体、缺失媒体或已丢失语义中恢复不存在的数据；不支持的输入必须给出可定位原因。
- 保证所有浏览器支持所有编解码器，或保证所有文件与 PowerPoint 逐像素相同。
- 将 PPTX 独有对象伪装成可编辑旧 PPT 对象；未知二进制记录的完整保留不随增量写入能力默认承诺。
