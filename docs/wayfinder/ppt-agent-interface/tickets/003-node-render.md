---
title: Node 无 Office 渲染
status: open
priority: P1
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

Agent 在没有浏览器、LibreOffice 和 Office 的 Node 环境中，怎样得到与浏览器一致的页面图像？

## 范围

| 产物 | 路径 | 说明 |
|---|---|---|
| SVG | 原生 `<text>` 路径（`renderSlideToSvg`） | `foreignObject` 只在浏览器可用，Node 只走原生文字路径 |
| 测字 | 宿主注入字体 Provider 的测量函数 | `text-measure.ts` 在 Node 中取不到 Canvas，不注入时明确报错，不退回估算宽度 |
| 字体 | 嵌入字体与宿主提供的字体字节，内联进 SVG | 沿用 `embeddedFonts`，SVG 自包含 |
| PNG | 宿主注入的光栅化函数（如 resvg） | 光栅化器不进依赖，未注入时调用 PNG 接口给出明确错误 |

## 完成条件

- 同一字体下，Node 与浏览器原生文字路径的 SVG 指纹在全部固件上一致；不一致的页逐条定位到原因。
- 用 LibreOffice 渲染同一批固件做对照，记录 SSIM 等差异与边界，作为说明而非及格线。
- 未注入测字或光栅化函数时报出稳定 reason，有测试覆盖。
- core 不新增运行时依赖，Worker 约束与「core 不碰 `document`」保持成立（架构边界检查通过）。
- 记录 Node 单页与整份文稿的渲染耗时。

## 不做

- 不在仓库内捆绑光栅化器或字体字节。
