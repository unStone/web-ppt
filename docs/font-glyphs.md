# 按需字体与字形

`@web-ppt/fonts` 的默认入口仍提供字体替换与网页字体加载。需要可复用的字体字节、字形位置和轮廓时，显式导入子入口。

| 入口 | 职责 |
|---|---|
| `@web-ppt/fonts/glyphs` | Provider、精确 face 匹配、文字分段、同源排版测量 |
| `@web-ppt/fonts/glyphs/harfbuzz` | 把宿主提供的 HarfBuzz 转为整形接口，不下载 WASM |
| `@web-ppt/fonts/glyphs/worker` | 客户端与 Worker 服务；一个文稿拥有一个 Worker |
| `@web-ppt/fonts/glyphs/browser` | 可选 FontFace 作用域；向浏览器安装字体并拥有导出资源 URL |

字体包不携带字体字节、整形器或 Cordis。产品编辑器用 Cordis 管理文稿生命周期；公开 SDK 不依赖框架。

```ts
import { createFontProvider } from '@web-ppt/fonts/glyphs';
import { createWorkerFontShaper } from '@web-ppt/fonts/glyphs/worker';

const worker = createWorkerFontShaper(() =>
  new Worker(new URL('./font-worker.ts', import.meta.url), { type: 'module' }));
const provider = createFontProvider({ loadShaper: async () => worker });
const face = await provider.register({
  id: 'body-regular', bytes, origin: 'explicit', sourceLabel: 'chosen.ttf',
}, { purpose: 'edit', signal });
if (face.ok) {
  const run = await provider.shape(face.value.id, 'AV office ffi ﬃ', {
    purpose: 'edit', script: 'Latn', direction: 'ltr', language: 'en', signal,
  });
}

// 先终止队列，再取消文稿请求，防止排队任务重启 Worker。
worker.dispose();
provider.dispose();
```

Worker 入口由宿主构建工具处理；HarfBuzz 和 EOT 解码器也由宿主安装并按需导入。
本仓库验证 HarfBuzz 1.6.1；该版本声明引用全局 `EmscriptenModule`。宿主启用严格依赖声明检查时，需安装开发依赖 `@types/emscripten`（已验证 1.41.5）；若配置了 `compilerOptions.types`，将 `emscripten` 加入其中。仅使用本包接口无需这些第三方类型。

```ts
import { serveFontWorker } from '@web-ppt/fonts/glyphs/worker';

serveFontWorker(self, {
  loadShaper: async () => {
    const [hb, { createHarfBuzzShaper }] = await Promise.all([
      import('harfbuzzjs'), import('@web-ppt/fonts/glyphs/harfbuzz'),
    ]);
    return createHarfBuzzShaper(hb);
  },
});
```

| 契约 | 使用方式与限制 |
|---|---|
| 字体来源 | `explicit`、文稿 `embedded`、显式 `substitute`；仅有家族名无法取得可嵌入字节 |
| 选择 | `resolve` 按家族、真实字重和斜体精确匹配；缺失或多义返回失败，不伪造样式 |
| 浏览器样式 | 现有编辑模型以常规 / 粗体表示字重，浏览器绑定与同源测量仅接受 400 / 700；Provider 本身可读取其他真实字重，绑定不符返回 `face-style-mismatch` |
| 字节 | 注册输入与 `embedding` 输出均独立复制；`faceInfo` 不复制整份字体 |
| 权限 | `purpose` 必填；外层 EOT、内层 OS/2 和显式限制取交集。Preview & Print 不开放编辑；No Subsetting 保留全部字节；Bitmap Only 不提供轮廓 |
| 字形 | `shape` 的定位字形和 UTF-16 原文簇分开；`ffi` 和 `ﬃ` 可对应同 GID。缺字返回原文区间 |
| 文字 | 首版静态 TTF/glyf、横排 LTR Latin/Han。调用方先按实际字体和脚本分段；换行由现有布局处理 |
| 不支持 | 可变字体、TTC、CFF、彩色字形、WOFF 解压、复杂脚本、RTL、竖排、艺术字变形返回明确原因 |
| 预算 | 默认单字体 32 MiB、累计 64 MiB、64 faces、65,535 glyphs、单次 100,000 UTF-16 单位；可通过 `limits` 降低。注册并发预留也计入预算 |
| 取消 | 字体校验分段让出事件循环；取消活跃 Worker 请求会终止该 Worker，其他请求从 Provider 字节重建。排队取消不影响活跃请求 |
| 关闭 | HarfBuzz 1.6.1 没有公开立即销毁 API，独占 Worker 的终止才是 WASM 生命周期边界。计数归零不等于进程 RSS 为零 |
| 单字体释放 | `release(faceId)` 释放注册与整形资源；已释放 ID 在同文稿内不可复用。Worker 重建其他只读请求，避免旧字体继续占用 WASM；安装失败和旧本机替换字体由产品自动释放 |

`withFontMeasurement` 接受沿用既有算法的同步布局回调，异步准备字宽后重放；返回的 `measureText` 可传给 core 的 HTML 和原生 SVG 渲染选项。字体样式必须与所选 face 相符，未准备的文本会报错。它不替代断行器，也不处理任意复杂排版。

浏览器宿主可用 `openEditor(source, { embeddedFonts: 'source' })` 保留原始容器而不提前同步解压；`createFontFaceScope(provider)` 安装已验证的字体，再用 `session.setFontResources(scope.resources(), { browserFontsReady: true })` 更新预览和导出投影。资源不写入编辑历史或 PPTX；调用者须在依赖它们的导出结束后关闭作用域，再关闭 Provider。产品文稿插件已管理此顺序。

## 复现证据

| 命令 | 产物 |
|---|---|
| `npm run test:fonts` / `npm run test:fonts:dist` | 源码 / 构建产物的 Provider、Worker、文稿、布局与浏览器合约；dist 另检查默认入口边界和真实 tarball 消费者类型 |
| `npm run proof:fonts` | 正式 Provider 经真实 Worker 生成 PDF / 纯轮廓 SVG 证明 |
| `npm run measure:fonts` | 完整中文字体、长文本、取消、释放、六份真实 MTX 的浏览器测量 |

Node 命令使用 `fnm exec --using=24.3.0`。Chrome 由 `CHROME_BIN` 或本机默认路径选择。Python 仅用于开发样本及独立读取，不进入浏览器或发布包：

```sh
python3 -m pip install --target out/font-glyphs/python -r tooling/font-glyph-requirements.txt
fnm exec --using=24.3.0 node tooling/fetch-font-glyph-sources.mjs
PYTHONPATH=out/font-glyphs/python python3 tooling/make-font-glyph-samples.py
PYTHONPATH=out/font-glyphs/python python3 tooling/font-proof-inputs.py
fnm exec --using=24.3.0 npm run proof:fonts
PYTHONPATH=out/font-glyphs/python python3 tooling/inspect-font-glyph-proof.py
PYTHONPATH=out/font-glyphs/python python3 tooling/make-font-glyph-samples.py --full-chinese
fnm exec --using=24.3.0 npm run measure:fonts
```

固定上游、许可证与 hash 在 `tooling/font-glyph-samples/sources.json`、`manifest.json`。真实 MTX 另读本地 POI 语料，hash 不符或缺失时测量失败，不把合成压缩标志当成真实压缩。004 的历史证据保留在[原型结论](wayfinder/ppt-portability-fidelity/font-glyph-prototype.md)，011 进度见[实现记录](wayfinder/ppt-portability-fidelity/font-glyph-implementation.md)。
