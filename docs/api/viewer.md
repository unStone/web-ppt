# 查看器与渲染

`@web-ppt/core` 负责解析 / 渲染 / 导出，`@web-ppt/viewer-core` 在其上提供导航、缩放、搜索、动画批次与播放。本文覆盖只读查看器的公开入口；编辑器见[编辑器接入](editor.md)，格式能力与边界见[格式能力](format-capabilities.md)与[格式限制](format-limitations.md)。

## 安装

```bash
npm i @web-ppt/core @web-ppt/viewer-core
```

## 基本用法

```ts
import { parse, slideToSvgFile, presentationToPrintableHtml } from '@web-ppt/core';
import { Viewer } from '@web-ppt/viewer-core';

const pres = await parse(file);                       // File | Blob | ArrayBuffer | Uint8Array
const viewer = new Viewer(container, pres, { animate: true, autoAdvance: true });

viewer.next();                                        // 有待播动画时先播动画，否则翻页
viewer.playNextAnimation();                           // 单独推进一批动画
viewer.finishAnimations();                            // 跳到本页动画终态
viewer.setZoom(1.5);
viewer.search('关键词');                               // → 命中的页索引数组
await viewer.exportPng(2);                            // → Blob

// 想让视频 / 音频真的能播（会引入 foreignObject，仅屏幕预览可用）
const v2 = new Viewer(container, pres, { media: 'player' });
// 动画时间线里的媒体调用（如上一动画之后自动播放）被浏览器拒绝时，容器收到该事件
container.addEventListener('web-ppt-playback-error', (e) => console.warn((e as CustomEvent).detail));

const svg = await slideToSvgFile(pres, pres.slides[0]);
const html = await presentationToPrintableHtml(pres); // 浏览器打印即得 PDF
// 有动画的页按点击批次展开成多页，逐步揭示的结构不会被压平
const stepped = await presentationToPrintableHtml(pres, { animationSteps: true });
```

## 图片 ZIP 导出

整份导出图片时显式加载按需入口；默认包含隐藏页并取每页动画终态，`skipHidden` 可跳过隐藏页，文件名始终保留原页码：

```ts
import { presentationToImageZip } from '@web-ppt/core/image-zip';

const zip = await presentationToImageZip(pres, {
  scale: 2,
  skipHidden: true,
  concurrency: 2, // 1–8；限制同时存活的 canvas / Blob
  onProgress: ({ completed, total, fileName }) => console.log(completed, total, fileName),
});
```

## Worker 解析

Worker 里没有 `DOMParser`（Window-only API），`parseXml` 会自动回退到自带的 `xml-lite`。图片不能跨线程传 blob URL，Worker 输出 `asset:N` 令牌 + 原始字节，主线程兑现成真实 URL。

```ts
import { parseInWorker } from '@web-ppt/core';

const worker = new Worker(new URL('@web-ppt/core/worker', import.meta.url), { type: 'module' });
const pres = await parseInWorker(worker, bytes);   // 主线程零阻塞
```

## 接自己的 UI

`Viewer` 只是 `PresentationState` 之上约 24 行 DOM 绑定。React / Vue / Svelte 可以直接驱动状态机：

```ts
import { PresentationState, playGroup, playTransition } from '@web-ppt/viewer-core';

const st = new PresentationState(pres, { animate: true, skipHidden: true });
st.subscribe((c) => {
  if (c.type === 'slide') setIndex(c.index);          // c.transition 非空时该播切换
  if (c.type === 'animation' && c.group) playGroup(el, c.group);
});
st.next();                     // 有待播动画先播动画，否则翻页
st.hiddenElementIds;           // 当前批次下应隐藏的元素 id
st.search('关键词');            // → 命中的页索引数组
```

## 稳定渲染

需要做增量更新、字符串比较或同页多视图时，显式指定稳定的 SVG 命名空间前缀：

```ts
import { renderSlideToSvg } from '@web-ppt/core';

const svg = renderSlideToSvg(pres, pres.slides[0], { idPrefix: 'editor-slide-1-' });
// 同一页 + 同一前缀的结果确定；同时挂载的每份 SVG 必须使用不同前缀。
```

需要书签、批注或编辑器回写锚点时，再开启编辑解析并交给 `EditDoc`；普通预览不承担这些对象与原包的内存。低层用法见[编辑器接入 § 低层 EditDoc](editor.md#低层-editdoc)。

## 相关

- [格式能力矩阵](format-capabilities.md)
- [格式限制](format-limitations.md)
- [API 稳定性与迁移](api-stability.md)
- [批注面板](comments.md)
- [性能与保真基准](../engineering/performance.md)
- [浏览器增强](browser-editing.md)
