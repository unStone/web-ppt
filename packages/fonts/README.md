# @web-ppt/fonts

PPT 里指定的字体，本机往往没有。这个包负责换一份**免费的、能自动按需下载的**替代字体，让文本仍然按接近原样的方式排版。

包里**一个字节的字体都没有**（gzip 2.8KB）。切片指向 [fontsource](https://fontsource.org/) 已发布的版本，由 jsDelivr 分发，用不到就不下载。

```bash
npm i @web-ppt/fonts
```

## 用法

```ts
import { collectFonts } from '@web-ppt/core';
import { loadFontsFor } from '@web-ppt/fonts';

// 只统计当前页：翻到了再补，已下过的切片是免费的
const usages = collectFonts([pres.slides[viewer.index]]);
await loadFontsFor(usages);
viewer.refresh(); // 排版是同步的、加载是异步的，首帧一定按回退字体断的行
```

`loadFontsFor` 做三件事，缺一不可：

| 步骤 | 为什么 |
|---|---|
| 本机装了原字体就跳过 | 零下载永远优于任何加载策略 |
| 取替代字体的 `@font-face`，**把家族名改写成原字体名** | 幻灯片里写的是「Calibri」，CSS 没有别名机制，只有让 `@font-face` 顶着这个名字，那段文字才会用上它 |
| `src` 开头补一条 `local()` | 同名 `@font-face` 会**盖掉**系统里的同名字体，不补这条，装了原字体的人反而被拖去下载替代品 |

按需下载完全交给 `unicode-range`——fontsource 的 CSS 自带切片划分，浏览器只取真正渲染到的那几片。

## 替换表

**拉丁一栏全是度量兼容字体**：每个字符的前进宽度与原字体逐一相等，断行位置因此与 PowerPoint 逐字对齐。LibreOffice 用的就是这一套。

| PPT 里的字体 | 替代 | 度量兼容 |
|---|---|---|
| Calibri | Carlito | ✓ |
| Cambria | Caladea | ✓ |
| Arial / Helvetica | Arimo | ✓ |
| Times New Roman | Tinos | ✓ |
| Courier New | Cousine | ✓ |
| Segoe UI / Tahoma / Verdana | Open Sans | ✗ 仅形近 |

中文：微软雅黑 / 苹方 / 黑体 / 等线 → Noto Sans SC，宋体系 → Noto Serif SC，楷体 → 霞鹜文楷。

只收**可再分发、可子集化**的字体（OFL / Apache）。MiSans、HarmonyOS Sans、阿里普惠这些「免费商用」的许可各自限制再分发与改字，不进内置表——要用就自己往 `overrides` 里加：

```ts
await loadFontsFor(usages, {
  overrides: { 思源黑体: { family: 'Noto Sans SC', metricCompatible: false, cjk: true } },
});
```

## 中文的代价要心里有数

中文默认也换——传进来的用量本来就该全部处理。但两边的账完全不同：

| | 拉丁 | 中文 |
|---|---|---|
| 一页的代价 | ~30KB（一个切片） | **553KB**（22 个不同汉字跨 18 个切片） |
| 换来什么 | 度量兼容，断行对齐 PowerPoint | 换个字形——汉字全角等宽，断行本来就不会变 |
| 不换的后果 | 字宽不同，行尾全错 | 系统自带中文字体接住，看着没问题 |

切片一片约 30KB、装约 160 个码位，用掉一两个也得整片下，整份中文文件收敛下来在 1MB 上下。**边际成本按切片算，不按字算**——「只用了 22 个汉字」反而是最亏的情形。

流量敏感的场景可以关掉，或者做成用户可选（官网就是这么做的）：

```ts
await loadFontsFor(usages, { cjk: false });

// 用户中途关掉时把已注入的声明撤回，然后重渲当前页。
// 只撤声明，已下载的字节留在 HTTP 缓存里，再打开是免费的
unloadFonts({ cjkOnly: true });
viewer.refresh();
```

## 自托管

不想依赖 jsDelivr 就换基址，目录结构与 fontsource 的 npm 包一致：

```ts
await loadFontsFor(usages, { base: 'https://cdn.example.com/npm' });
```

## 导出的另一半

`<img>` 加载的 SVG 是隔离文档，拿不到页面注册的字体。导出 PNG / 独立 SVG 时必须把命中的切片内联进去——`collectFonts` 给出的字符集就是为这个准备的。

## 许可

MIT。替代字体本身各自遵循其原始许可（OFL-1.1 / Apache-2.0），本包不分发字体文件。
