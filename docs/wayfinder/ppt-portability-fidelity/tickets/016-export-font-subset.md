---
title: 导出字体子集化与替代字体内联
status: closed
assignee: zcode
priority: P1
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

PNG / 独立 SVG / 打印导出在隔离文档里拿不到页面字体：嵌入字体被整份 base64（单页还带上全部未用家族），替代字体完全不内联、收件人机器上回退系统字体。如何按导出范围精确子集化并补齐替代内联，同时默认关闭时产物逐字节不变？

## Answer

技术方案与实测见[设计文档](../../../design/export-font-subset.md)。要点：

| 层 | 实现 |
|---|---|
| core | `FontSubsetter` / `ExportFontOptions` 类型（[types.ts](../../../../packages/core/src/types.ts)）；导出选项 `fonts` 消费引擎：按 `collectFonts` 字符集子集化、无用量家族整脸剔除、失败按稳定 reason（`subset-failed` / `unused-family` / `subsetter-error`）回退整字体内联（`onFontFallback` 可观察）；打印整稿并集字符集 + 跨页共享一份 data URI（缓存 Promise 防并发重复子集）；`EmbeddedFont` 增加 `unicodeRange` / `sizeAdjust`；`image-zip` 透传 `fonts` |
| fonts | 新可选入口 `@web-ppt/fonts/subset`：`createHarfBuzzSubsetter(wasm)` 手绑 harfbuzzjs 1.6.1 自带的 `harfbuzz-subset.wasm`（宿主注入字节，包不携带；变量字体钉默认轴；输出确定性字节，同输入两次字节一致）。默认入口新增 `exportFontFaces(usages)`：解析 fontsource CSS、只取与字符集相交的切片转 data URI，家族名写回原名，粗体西文与 U+5F 下划线按实测 `size-adjust` 缩放 |
| 接线 | site（批注导出四格式、WebMCP 渲染）与 viewer（PNG / SVG / 打印）显式开启；wasm 经 `tooling/sync-font-wasm.mjs` 拷进 `public/vendor`（产物不进 git），运行时固定路径 fetch——不用 `?url` 导入，esbuild 打的 WebMCP 测试没有该语义 |

引擎评估：cn-font-split@7.4.3 的 npm 发布形态依赖 koffi（Node 原生 FFI），浏览器运行时不可用，保留其构建期定位；harfbuzzjs 是 site 既有依赖且随包分发 subset wasm，采用之。

## 验收

- 核心管线（core 套 2528 项含新增 23 项）：默认关闭逐字节不变；未用家族剔除；charset 按家族传递；引擎失败 / 抛错回退整字体且 reason 可观察；打印并集 + 两页共用一份 data URI；`unicode-range` / `size-adjust` 输出；PNG 路径同样生效
- 子集引擎（fontSubset 12 项）：真实 wasm 对固件中文字体 12,216B → 2,484B，cmap 恰等于请求字符与原字体交集；两次运行字节一致；输入不被修改；CFF OTF 保留 OTTO；WOFF / 畸形输入明确失败不抛；dispose 后调用即错；pyftsubset 交叉验证覆盖一致（本机有 fontTools 时执行）
- 替代脸集（core 套内 14 项）：命中切片才下载、未命中的 404 切片跳过、css / slice 不可取按 reason 报告、粗体缩放与下划线面顺序、两次调用结果一致、`cjk:false` 跳过中文、默认不因本机已装跳过
- 浏览器（exportFontBrowser 5 项）：真实 Chrome 内单页导出 SVG 16,908B → 3,932B；**子集开 / 关两次导出 PNG 光栅字节一致**；与无字体导出不同（排除空转）；skipInstalled 探针为真时不取切片
- 门禁：`npm run check && npm test && npm run build && npm run verify` 全绿；`check-font-glyph-boundary` / `check-font-glyph-package` 登记新入口（禁 DOM、禁打包 wasm、tarball 消费者类型检查含 `@web-ppt/fonts/subset`）
