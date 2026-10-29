# Node 无 Office 渲染

`@web-ppt/core/node` 按需入口：在没有浏览器、LibreOffice 与 Office 的 Node 环境中渲染 `.pptx` / `.ppt` 页面。SVG 走原生 `<text>` 路径（与导出独立 SVG 文件同一条），PNG 由宿主注入的光栅化函数生成。配合 [结构化读出](agent-describe.md)与[布局检查](agent-layout-lint.md)构成 Agent 的确定性读出 / 检查 / 渲染闭环。

## 接口

```ts
import { parse } from '@web-ppt/core';
import { renderSlideSvgInNode, renderSlidePngInNode } from '@web-ppt/core/node';

const pres = await parse(bytes);
const svg = renderSlideSvgInNode(pres, pres.slides[0], { measureText });
const png = await renderSlidePngInNode(pres, pres.slides[0], { measureText, rasterize, scale: 2 });
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `measureText` | 是 | `TextMeasure`（`(text, run, scale) => px 宽度`）。推荐 `@web-ppt/fonts/glyphs` 的 `withFontMeasurement(provider, render, options)` 产物——HarfBuzz 按宿主提供的字体字节量出真实字宽 |
| `rasterize` | PNG 必填 | `(svg, { width, height }) => Uint8Array \| Promise<Uint8Array>`，如 resvg；返回非空 PNG 字节 |
| `scale` | 否 | PNG 像素倍率，默认 2，与浏览器 `slideToPng` 一致 |
| 其余 | 否 | 与 `RenderOptions` 同义（`hiddenElements`、`showComments` 等）；`textMode` 固定 `'svg'`、`media` 固定 `'badge'` |

## 稳定 reason

缺注入时抛 `NodeRenderError`（`error.reason` 可程序判定），**不退回估算宽度**——估算断行与真实字体断行不同，静默产出看似正确的 SVG 比直接拒绝更难排查。

| reason | 触发 |
|---|---|
| `node-measure-required` | 未注入 `measureText`，或光栅化函数返回空 / 非 `Uint8Array` 字节 |
| `node-rasterizer-required` | 调用 PNG 接口未注入 `rasterize` |

## 资源地址与确定性

资源地址是会话态：同一文件两次解析产生的 blob 地址不同（浏览器行为一致），但 Node 原生 blob 地址可被 `fetch` 解析回字节。字节本体也在 `pres.package.assets`（`keepPackage: true` 时）。确定性比对按实际字节寻址——把 SVG 中的地址替换为 `data:` URI（从 assets 映射取字节）后，独立进程重复渲染逐字节一致。

## 边界

- core 不新增任何运行时依赖；光栅化器与字体字节均由宿主注入，不在仓库内捆绑。
- `foreignObject` 路径（HTML 排版）仅浏览器可用，本入口恒为原生 `<text>`——文本在 Inkscape / librsvg 等工具中不丢失。
- 数学公式 run 在 `withFontMeasurement` 的测量回调中会抛 `unsupported-layout`（fonts 包语义）；含公式的页面应先经该回调的失败结果分流。
