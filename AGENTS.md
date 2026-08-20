# AGENTS.md

纯浏览器端 PPT 渲染引擎：`.pptx` / `.ppt` → 统一 JSON Schema → SVG。零服务端、零框架，唯一运行时依赖是 fflate。

## 仓库

| 路径 | 说明 |
|---|---|
| `packages/core/` | `@web-ppt/core` —— 解析 / 渲染 / 导出，无框架无 DOM 依赖 |
| `packages/viewer-core/` | `@web-ppt/viewer-core` —— headless 状态机 + 播放层 |
| `packages/viewer/` | 开箱即用查看器（private） |
| `packages/site/` | 官网（private），含浏览器内实时 Demo |
| `fixtures/` | 测试样本，**全部由 `tooling/make-*.mjs` 确定性生成** |
| `tooling/` | 测试框架 / fixture 生成 / LibreOffice 对照 / 性能基准 |
| `test/snapshots/` | 142 个渲染快照基线 |

`viewer` 与 `site` 通过**包名**消费上游，与外部用户走同一条路径——边界一旦被破坏，它们立刻编译失败。

## 命令

| 命令 | 说明 |
|---|---|
| `npm run check` | 全仓类型检查（走源码，**不需要先构建**） |
| `npm test` | 全部测试：1489 + 109 项断言、142 个快照 |
| `npm run fixtures` | 重新生成全部测试文件 |
| `npm run build` | 构建两个发布包 |
| `npm run dev` | 启动 viewer |
| `npm run compare <file>` | 用 LibreOffice 做 ground truth 对比，产出 SSIM / MAE / Δmax / 差异像素占比 + 热力图 |

**改完代码必须跑**：`npm run check && npm test && npm run build`。三条都绿才算完成。

## 不可破坏的约束

1. **`render/` 只能依赖 `types.ts`**。渲染层不认识任何文件格式；加新输入格式不该动它一行。
2. **格式按魔数识别**，不看扩展名：`PK` → pptx，`D0CF11E0` → ppt。
3. **两条文本渲染路径**：`foreignObject` + HTML 排版（屏幕预览、PNG 导出）与原生 `<text>` + 自实现测量断行（独立 SVG 文件、打印 HTML）。理由是**可移植性**：`foreignObject` 只有浏览器认，Inkscape / librsvg / 设计工具打开会整块丢失文本。交出去的文件必须走 `<text>`，别合并这两条路径。
4. **`core` 不碰 `document`**，要能在 Worker 里整包运行（`xml-lite.ts` 就是为此存在：Worker 里没有 `DOMParser`）。

## 已知陷阱

踩过的坑，改动前先读：

| 陷阱 | 说明 |
|---|---|
| **渲染结果同进程不可重复** | defs id 来自跨解析累加的全局计数器（同页多个 SVG 不能撞 id，是有意设计）。同一份文件连渲两次，产物不同。要比对渲染结果**必须在独立进程里算**，见 `tooling/lib/ppt-fingerprint.mjs` |
| **快照挡不住「一开始就错」** | 快照只能发现「变了」。判断保真度要拿 **LibreOffice 实际渲染做 ground truth**（`npm run compare`，产出单文件页面，直接 open，不需要 dev server）。历史教训：`shade`/`tint` 曾在 sRGB 里直乘，最大偏差 Δ69，快照一路绿着。注意 LibreOffice 自己也只是另一种近似（字体、抗锯齿、图表画法都不同），SSIM 不会到 1，它的用途是**横向比较改动前后**和定位整片偏色，不是及格线 |
| **固件覆盖盲区** | 加能力时**必须同时加固件**。隐藏页曾经零固件覆盖，让一个 `skipHidden` 的真 bug 在 986 项断言下活了很久 |
| **LibreOffice 转换非确定性** | `.ppt` 样本由 LibreOffice 转出，字节不可重复。`make-ppt-samples.mjs` 因此按**渲染结果**而非字节比对，内容没变就保留原文件 |
| **固件必须确定性** | `npm run fixtures` 重跑两次字节必须一致，CI 会验。写生成脚本时不要引入时间戳 / 随机数 |
| **package-lock 不能用镜像源** | 用 `--registry=npmmirror` 装依赖会把镜像 URL 烘进 lock，新版 npm 直接 `EALLOWREMOTE` 拒绝。装依赖一律用官方源；本机代理导致 TLS 失败时用 `env -u HTTP_PROXY -u HTTPS_PROXY npm i` 绕开 |
| **画布污染只发生在 `blob:`** | 含 `foreignObject` 的 SVG 经 **blob: URL** 加载会让画布被判污染（`toBlob` 抛 `SecurityError`），换成 **`data:` URI 就不会**——实测 Chrome 148 仍是这样。Chromium 曾提案让 blob: 也不污染（原计划 M131），至今未生效，别依赖。所以 `slideToPng` 走 data: URI + `foreignObject`，排版与屏幕预览逐像素一致 |
| **SVG-as-image 是隔离上下文** | 被 `<img>` 加载的 SVG 拿不到宿主页面的 `@font-face` / FontFace API 注册的字体（实测：未知字体名与页面已注册字体的渲染结果完全一致）。**系统已安装字体可用，其余必须把 `@font-face` 连同 base64 字体内联进 SVG 的 `<style>`**——`svg.ts` 的 `embeddedFonts` 就是干这个的，别把它优化掉 |
| **WebKit 不给 `foreignObject` 应用 SVG 缩放** | [WebKit bug 23113](https://bugs.webkit.org/show_bug.cgi?id=23113)，2008 年至今，新的 LBSE 引擎才修。我们的幻灯片是 `viewBox` + `width:100%`，永远处于被缩放状态，受影响的 Safari / iOS 上 foreignObject 里的文本会按 1× 排版并错位。`viewer-core/foreign-object.ts` 做运行时探测，中招就整页切到原生 `<text>`（代价：文本不可选中）。**不要用 UA 判断，也不要照搬 marpit-svg-polyfill 的 `getScreenCTM()` 补偿**——那套要求 foreignObject 位于原点，而我们的嵌在每个形状各自的 translate/rotate 里 |
| **量不到就得记住量不到** | `text-svg.ts` 的 2D 上下文探测必须只做一次。Node / jsdom / 反指纹浏览器里 `getContext('2d')` 恒为 null，不缓存这个结论就会在每次测字时新建一个 `<canvas>`，一页文本能造出上千个 |
| **`chart/` 是解析器不是渲染器** | 它读 chart XML 产出 `SlideElement[]`。依赖 `pptx/color`·`text` 是正当复用（chart XML 本身就是 OOXML），不要试图「解耦」——那只会让 DrawingML 颜色解析复制一份 |

## 分层

三条输入链路各自独立收敛到 `types.ts`：

```
.pptx (Zip+OOXML) ─┐
.ppt  (CFB+Escher) ─┼→ types.ts 统一 Schema → render/ → SVG
EMF/WMF (GDI 流)  ─┘
```

`src/geometry/` 是**格式无关的公共层**（ECMA-376 全部 187 个预设形状求值，零 import），两条链路共用。读 OOXML 的部分留在 `pptx/geometry.ts`。图表与图元文件解码器经 hook 注入，可 tree-shake。

## 发布

版本号改完打 tag 即可，`release.yml` 走 npm Trusted Publishing（OIDC），**Secrets 里不存任何凭据**：

```bash
# 两个包的 package.json 版本必须一致，否则流水线直接失败
git tag -a v0.3.0 -m "v0.3.0" && git push origin v0.3.0
```

流水线：校验 tag 与包版本一致 → 类型检查 → 重生成固件 → 全部测试 → 构建 → 按 `core` → `viewer-core` 顺序发布（后者以前者为 peer 依赖）。

## 约定

- **注释与提交信息用中文**，遵循 Conventional Commits（破坏性变更用 `!`）
- **注释解释「为什么」，不复述「做了什么」**。非显然的约束、踩过的坑、格式规范的怪异之处才值得写
- 文档能用图和表格表达的一律用图表，文字精简
- 改 README / 官网里的数字（断言数、体积、性能）时**先实测**，不要照抄旧值
