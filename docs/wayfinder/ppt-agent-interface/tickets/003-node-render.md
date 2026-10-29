---
title: Node 无 Office 渲染
status: in-progress
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

## 进度

| 部分 | 状态 | 证据 |
|---|---|---|
| Node 按需入口 `@web-ppt/core/node` | ✅ | `renderSlideSvgInNode` / `renderSlidePngInNode`；缺测字 / 光栅化注入抛 `NodeRenderError`，reason 为 `node-measure-required` / `node-rasterizer-required`，不退回估算断行 |
| 纯 Node 可行性 | ✅ | 无 jsdom：`parse + renderSlideToSvg(textMode:'svg', measureText)` 整链可跑；Node 原生 `URL.createObjectURL` 的 blob 地址可被 `fetch` 解析回字节（编辑器字体资源测试依赖此能力），`tooling/test-agent-node-render.mjs` worker 子进程不装 dom-env |
| 渲染确定性口径 | ✅ | 资源地址是会话态（浏览器同样如此），确定性按实际字节寻址：blob 地址替换为 `data:` URI 后独立进程两次渲染 SHA256 一致（与等价指纹的既有口径一致） |
| 注入测量端到端 | ✅ | `@web-ppt/fonts/glyphs` 的 `withFontMeasurement`（HarfBuzz）注入 `renderSlideSvgInNode`：连字行 669px 与字体布局套件同源、autofit 用注入字宽、入口与 `renderSlideToSvg` 同参逐字节一致 |
| 跨进程确定性 | ✅ | 独立进程两次渲染 SHA256 一致（sample 全部页） |
| 耗时记录 | ✅ | `out/agent-node-render/timing.json`：sample 3 页 parse 14ms / 渲染 4ms；showcase 7 页 parse 37ms / 渲染 9ms（M 系本地） |
| 架构边界 | ✅ | `check-node-boundary.mjs`：默认 core 入口零触达 Node 入口；core 无新增运行时依赖；`node-export.ts` 无 DOM 引用 |
| 浏览器指纹对照 | ⏳ 第二批 | 同一字体下浏览器原生路径与 Node 注入路径整页 SVG 指纹比对，不一致逐条定位 |
| LibreOffice 对照 | ⏳ 第二批 | 记录 SSIM 等差异与边界，作为说明而非及格线 |
