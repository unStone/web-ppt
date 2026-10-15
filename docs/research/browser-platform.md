# 浏览器平台能力与对策

2026-08 调研结论：三项浏览器能力的现状决定了哪些路径必须保留兜底、哪些只能留在产品层。

| 平台能力 | 事实 | 对我们的影响 | 对策 |
|---|---|---|---|
| WebKit LBSE | 2026 年 7 月 Igalia 仍在做性能优化，**默认未开启**，需 runtime flag | Safari 的 `foreignObject` 缩放 bug 还在 | **保留 ppt-editor `034` 的 engine 行盒路径，不要因为「LBSE 快落地了」删掉** |
| EditContext | 仍**只有 Chromium**，Safari/Firefox 未实现（有社区 polyfill） | 自绘文本 + 完整 IME 只能在 Chrome 用 | contenteditable 保持主路径；EditContext 只做渐进增强，且必须在两条路径跑同一套断言，见[浏览器增强](../api/browser-editing.md) |
| File System Access | `showSaveFilePicker` **只有 Chromium**；Safari/Firefox 仅 OPFS，且 Firefox 是**有意不实现** | Safari/Firefox 保存只能是下载，无法原地覆盖 | 产品层双路径：能力检测、当前会话目标与另存为；不支持则 download，拒绝/取消不偷偷下载。**不进 `editor` 包**，见[本机文件保存](../api/local-file-save.md) |

WebKit 缩放 bug 的运行时探测与降级见 [AGENTS.md 已知陷阱](../../AGENTS.md#已知陷阱)。
