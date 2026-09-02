---
title: 批量导出幻灯片图片
status: closed
assignee: /root
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

## Answer

新增按需入口 `@web-ppt/core/image-zip`，公开
`presentationToImageZip(presentation, { scale, skipHidden, concurrency, onProgress }) → Promise<Blob>`。
默认导出全部页面并取动画终态；`skipHidden` 只过滤隐藏页，文件名仍按来源页码稳定生成为
`slide-001.png`。比例必须为有限正数，同时拒绝超过浏览器 canvas 边长的结果；并发必须是 1–8 的整数。

单页 PNG、独立 SVG 与打印 HTML 的浏览器导出被抽到同一个 `browser-export` 深模块。批量入口继续走
data URI + `foreignObject`，只内联 `<image>` 与 `@font-face` 资源，画布污染时复用原生 SVG 文本回退；
默认 core 入口没有批量 API、ZIP 调度或新的运行时依赖。无 DOM 环境导入安全，只有真正光栅化时才报出
缺少 DOM / Image / canvas。

ZIP 使用 fflate `ZipPassThrough`，固定 1980-01-01 元数据，并按来源页序写目录。固定大小批次在进入下一批前
完成 Blob→字节转换，canvas 在每页结束时立即归零；失败批次等待所有在途页面收束后，以
`PresentationImageExportError` 携带原页码和文件名拒绝 Promise，调用方永远拿不到半成品。

## Evidence

- TDD 红灯：`npm run test:core` 首次因公开入口 `packages/core/src/image-zip.ts` 不存在而失败；实现后
  批量导出契约及 2,230 项 core 断言、186 个快照全绿。
- 新增确定性 `sample-image-zip.pptx`（3 页、1 张隐藏页、退出动画终态）；连续生成 SHA-256 均为
  `6d9139f6741bf04a8269e407d5e14c84b3570b7339df6fbe7b6fb141f2cc85a8`。
- 真实 Chrome 解包验证原页码命名、PNG 尺寸、固定 ZIP 目录、连续两次字节一致、动画终态；确定性纯色图片
  直接检查输出像素，有效 TTF 固件证明嵌入字体改变 PNG；210 页在 `concurrency: 3` 下峰值并发 3，
  210 个 canvas 全部归零释放，SecurityError 回退通过。
- 第二页注入失败与资源内联失败都只得到带来源页码/文件名的原子拒绝；空文稿也执行 canvas 尺寸校验。
  默认入口依赖图、实现标识和 92KB gzip 预算均有构建期守卫。
- `npm run compare -- fixtures/sample-image-zip.pptx` 已生成 LibreOffice 首页面对照工件
  `out/compare/sample-image-zip/compare.html`。
- 完整门禁：`npm run check && npm test && npm run build && npm run verify` 全绿；78 份固件 / 256 页 /
  512 对独立进程 SVG 指纹一致，总计 4,449 项断言。
