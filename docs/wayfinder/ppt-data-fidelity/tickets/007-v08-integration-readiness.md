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

- 全部现有媒体保存矩阵与 ChartEx 补丁/生成保存已纳入 30 件统一 Office 清单，LibreOffice 与 Windows 工作流同源。
- 30 件工件已逐件通过 LibreOffice 打开和 PDF 导出；这不代替现代 Office 的原生图表或媒体播放验收。
- 默认入口无 ChartEx 布局/工作簿实现，独立 OPC 子包不因解析上下文继承引入 core。
- 八页原生/地图回退的屏幕、独立 SVG、PNG、打印与编辑保存专项已接入全量测试。

尚未关闭：真实类型语料、现代 Office 原生布局、媒体实际播放和官网自动按需加载的跨能力旅程仍需验收。
未细化的图片效果、3D、AT、EditContext 与 1.0 冻结继续保留在地图的后续范围中。

Windows 诊断新增阻塞：16.0 Build 4266 在可见/隐藏窗口均无法打开 `chart-data-edited.pptx`；
ChartEx 原始/生成探针则能打开但只显示图片。尚未证明是源固件、保存结果还是安装环境问题，不能作为通过记录。
保存前后及公开来源对照已准备；继续传送诊断样本需要当前会话的远程文件传输授权。
