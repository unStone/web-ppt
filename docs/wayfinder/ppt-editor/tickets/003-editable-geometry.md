---
title: 让预设几何在编辑投影中可重算
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./002-editable-parse-provenance.md
---

## Question

如何只在编辑解析中保留 `preset + adj` 几何语义，并提供格式无关的 `resolveGeomPath`，使宽高变化后路径正确重算且只读 Schema 与渲染快照不回归？

## Resolution

答案是让预设几何语义留在格式无关的 `geometry/` 边界，而不是让渲染器或未来编辑包重新认识 OOXML：

- 新增 `GeomSpec { preset, adj }` 与纯函数 `resolveGeomPath(geom, w, h)`，从根入口和 `@web-ppt/core/geometry` 都可用。它复用现有 187 个预设求值器及其异常输入安全网，不复制几何实现。
- `.pptx` 仅在 `parse(..., { edit: true })` 时把语义挂到 `ElementEditInfo.geom`；显式几何与从版式/母版继承的形状、图片占位符都会保留，普通解析结果没有新增字段。自定义 `custGeom` 暂不冒充预设几何。
- `.ppt` 的 edit 模式把 MSO 预设和调节值换算为同一 `GeomSpec`，因此旧格式转换编辑时也能正确缩放；它只携带格式无关几何，不伪造 OPC 包、OOXML part、`spid` 或占位符身份。
- 当前宽高调用 `resolveGeomPath` 会逐字节复现解析期路径；改变宽高会重新求值 `d/open`。`render/` 没有改动，现有两条预览路径继续消费烘焙后的 `path`，编辑投影负责在提交尺寸时替换派生字段。

测试复用确定性固件 `showcase.pptx`、`showcase.ppt` 与 `sample-placeholder.pptx`，覆盖显式 `adj`、开放路径语义、占位符继承、图片几何、`.ppt` 映射、自定义几何隔离、根入口/子入口一致性，并逐页比较普通解析与编辑解析的 SVG。

验证证据：`npm run check`、`npm test`（core 1913、metafile 130、162 个快照）与 `npm run build` 全部通过；210 页 / 12810 元素基准中只读常驻 630MB、编辑常驻 633MB（约 +0.5%，低于 +40% 预算），50640 次几何重算耗时 95.8ms（1.89µs/次）；core 86.09KB gzip、geometry 9.20KB gzip，`npm pack --dry-run` 的公开声明与 51 个包文件校验通过。
