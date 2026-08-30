---
title: 批量导出幻灯片图片
status: open
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

core 已有与预览逐像素一致的 `slideToPng`，fflate 也是唯一运行时依赖，但产品层仍要自行循环、命名和打包。
如何新增整份演示批量导出图片 ZIP 的按需 API，复用现有 data URI + foreignObject 路径与 SecurityError 回退，
同时给出稳定文件名、隐藏页策略、比例校验和有界并发，避免大文稿一次性持有所有画布与 Blob？

ZIP 元数据必须确定性，页序与输出清单一致；失败要指出具体页且原子拒绝半成品。默认 core 入口不能引入第二套
光栅化实现、PDF 写入器或新依赖，Worker/无 DOM 环境只在实际调用浏览器导出 API 时给出清晰错误。

验收：多页、隐藏页、动画终态、内联/外链图片、嵌入字体与 SecurityError 回退契约通过；连续两次导出 ZIP
结构一致，210 页有界并发与资源释放可观测，解包 PNG 尺寸/命名正确，四段仓库门禁全绿。
