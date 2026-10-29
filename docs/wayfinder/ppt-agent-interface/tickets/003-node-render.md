---
title: Node 无 Office 渲染
status: closed
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

## Resolution（2026-10-30 关闭）

完成条件逐条对应：

| 完成条件 | 结果与证据 |
|---|---|
| 同一字体下双端指纹一致，不一致逐条定位 | `tooling/test-agent-node-render-parity.mjs`：仓库样本字体字节双端注册（浏览器 FontFace / Node Provider，斜体为运行时翻转 OS/2 fsSelection 与 head macStyle 的同度量声明），全部 run 字体栈改写后唯一剩余变量是测字来源。168 份固件（剔除加密）中 44 份的 152 页可比对：**148 页逐字节一致**；4 页差异全部归因——3 页含 OMML 公式（`mathMeasure` 测量源两端不同：浏览器 canvas vs Node 确定性估算）+ 1 页艺术字 `textPath` 的字间距对测量微差有放大。124 份固件因注入样本字体缺字（`missing-glyphs`）不满足「同一字体」前提，跳过并计数，明细落盘 `out/agent-node-render/parity.json` |
| LibreOffice 对照记录（说明非及格线） | `tooling/record-agent-node-libreoffice.mjs`（resvg 光栅化，devDep 不进发布依赖）：sample SSIM 0.888 / MAE 7.4 / 差异像素 5.78%；showcase 0.7705 / 10.05 / 13.3%；cjk-squeeze 0.7148 / 11.5 / 11.48%。量级与既有 `compare` 管道一致（LibreOffice 自身是另一种近似）；缺字固件的 Node 侧按宿主策略回退与 core 同式的确定估算 |
| 稳定 reason 有测试 | `test-agent-node-render.mjs`：`node-measure-required` / `node-rasterizer-required` / 光栅化空字节 |
| core 零新增运行时依赖、不碰 document | `check-node-boundary.mjs` + 架构分层审计；resvg / pngjs 仅为 devDependencies |
| 耗时记录 | sample 3 页 parse 14ms / 渲染 4ms；showcase 7 页 parse 38ms / 渲染 10ms（M 系本地） |

附带修正：`measureTextWidth` 的公式分支提到外部 measurer 之前——公式布局自带 `mathMeasure`（专用数学字体栈），注入测字遇公式 run 时不再整页错误隔离；fonts 包 `withFontMeasurement` 同步删除该死分支（诊断路径对竖排 / 艺术字 / 公式 / 小型大写的 `unsupported-layout` 报告不受影响，那是 site 诊断的独立实现）。

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
| 浏览器指纹对照 | ✅ | 见 Resolution：148/152 页逐字节一致，4 页归因（公式测量源 / textPath 字距放大），`test-agent-node-render-parity.mjs` 固化为门禁 |
| LibreOffice 对照 | ✅ | 见 Resolution：SSIM 0.71–0.89 量级记录，`record-agent-node-libreoffice.mjs` 可复跑 |
