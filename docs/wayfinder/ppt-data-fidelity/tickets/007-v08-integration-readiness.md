---
title: 完成 0.8 集成验收
status: open
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./001-chart-data-editing.md
  - ./003-chartex-hierarchy-rendering.md
  - ./004-chartex-statistical-rendering.md
  - ./005-media-insertion.md
  - ./006-site-i18n.md
  - ./009-local-file-save.md
---

## Question

图表数据、六类扩展图表、媒体插入和官网国际化各自关闭后，如何证明它们组成可交付的 0.8 产品面，而不是
四组只能在单元测试中工作的能力？

审计全部公开导出、按需入口、默认包边界、编辑权限、历史/恢复/协同、补丁/生成保存、`.ppt` 另存、两条文字
路径、真实浏览器、静态站点 SEO、错误文案和中英文文档。新增跨能力旅程：打开含真实图表和媒体的文件，修改
数据并增删系列/类别，插入音视频，混合经典图表、六类原生 cx 与地图 fallback，保存重开并在中英文编辑页间
无损切换，并验证本机文件保存与显式下载两种交付方式。

全部 0.8 Office 工件进入单一机器可读清单并逐件通过 LibreOffice；Windows PowerPoint 工作流消费当前提交绑定的
同一清单。固件连续重生成两次字节一致，默认入口不加载 SpreadsheetML/cx/媒体/i18n 数据，八包 API、版本、
README、CHANGELOG 与路线图按实测同步。`npm run check && npm test && npm run build && npm run verify` 全绿且
独立规格/标准审查归零后，才能关闭本票与地图；不创建 tag、不推送、不发布 npm。

## 已推进

- 全部现有媒体保存矩阵与 ChartEx 补丁/生成保存已纳入 34 件统一 Office 清单，LibreOffice 与 Windows 工作流同源。
- 34 件工件已逐件通过 LibreOffice 打开和 PDF 导出；这不代替现代 Office 的原生图表或媒体播放验收。
- 默认入口无 ChartEx 布局/工作簿实现，独立 OPC 子包不因解析上下文继承引入 core。
- 八页原生/地图回退的屏幕、独立 SVG、PNG、打印与编辑保存专项已接入全量测试。

功能集成已补：官网自动按需加载、图片/立体工具、画布 AT 与 EditContext；混合图表/媒体/外观的两条保存、
Chrome 重开、双色调 PNG/SVG 像素与原生 IME 已通过专项验证。API 契约、迁移和类型负例见 [API 准备](../../../api-stability.md)。

仍保留外部验收：其他真实类型语料、现代 Office 原生布局、PowerPoint 媒体实际播放与正式冻结。
用户于 2026-09-06 明确要求跳过 Windows 真机，本轮不继续传输或执行远程验证。
经典图表保存问题已定位并修正：系列标题应为 `c:tx/c:v` 或 `c:strRef`，`c:ser` 必须位于绘图设置之前；
严格 XML 回归覆盖工作簿和缓存数据源，不将修复本身标为 Windows 整轮通过。
