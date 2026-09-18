---
title: 提供可搜索文字与矢量图形的 PDF
status: closed
assignee: cursor
priority: P1
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./011-font-glyph-implementation.md
---

## Question

如何直接导出包含真实文字与矢量图形的 PDF，同时明确字体缺失与复杂特效的降级范围？

## Answer

可选入口 `@web-ppt/core/pdf/vector`（及 `/browser` 适配）已验收；普通文字可搜索、普通图形为矢量，复杂特效对象级回退并定位。范围与已知差异见[实现进度](../vector-pdf-implementation.md)。

| 验收项 | 结果 |
|---|---|
| 独立文字提取 | MuPDF、Poppler `pdftotext`、pypdf 交叉核对原文与页序 |
| 矢量图形与字体 | Type0 / ToUnicode / 嵌入字节；Chrome SVG ↔ MuPDF 像素对照 |
| 失败 / 生命周期 | 缺字体/缺字/取消/多页/重复导出/Cordis 资源收口 |
| SVG 方言 | 固件盘点允许项与回退表无缺口 |
| 产品 | 官网中英文选项与回退说明；Cordis 字体与导出生命周期 |
| 门禁 | `check → test → build → verify` 全绿（本目标收口时复验） |

### 证据命令

```bash
eval "$(fnm env)"
npm run test:pdf:vector
npm run check && npm test && npm run build && npm run verify
```

### 明确不扩大的边界

更广 ICC / HDR、动画帧时刻、非 solid 文字装饰等仍走显式拒绝或对象级回退；MuPDF 图案屏幕栅格差异按实测保留。Windows PowerPoint 真机暂缓。
