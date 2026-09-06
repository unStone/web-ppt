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
