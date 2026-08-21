/**
 * 替代字体的字节从哪儿来。
 *
 * 不自建切片、也不把字体打进包里。理由是实测出来的：拿一份 437 个不同汉字的
 * 中文文档试，Google/fontsource 现成的切片划分要下 538KB，按字频重排后
 * 是 460–700KB——省不下来。原因在分布本身：那 437 个字里 96% 落在词频前 2000 名，
 * 却只用掉其中约两成，任何覆盖「前 2000 名」的切片都得整片下。真正能把它压到
 * ~63KB 的只有精确子集（要服务端）或 IFT（浏览器还没发）。
 *
 * 所以这里做的事只有一件：指向 fontsource 已发布的切片，版本钉死。
 * 发到 npm 的包 jsDelivr 自动分发，`access-control-allow-origin: *`、
 * `cache-control: immutable`，零服务端不破，也不依赖 fonts.googleapis.com
 * （那个域名在国内不可达）。
 */

/** 默认 CDN 基址；自托管时换成自己的地址即可 */
export const DEFAULT_BASE = 'https://cdn.jsdelivr.net/npm';

/** 一个替代字体在 fontsource 上的坐标 */
export interface FontPackage {
  pkg: string;
  version: string;
  /** 该包实际提供的正体字重；请求别的字重要就近取 */
  weights: number[];
  /** 提供真斜体的字重；CJK 一律为空，斜体交给浏览器合成 */
  italics: number[];
}

/**
 * 替代字体对应的 fontsource 包与版本。
 *
 * 版本必须钉死：fontsource 换代时切片划分和文件名都会变，跟着 latest 走
 * 等于让线上排版随时可能漂。升级时连同这里一起改，别用范围号。
 *
 * `weights` / `italics` 是各包**实际提供**的档位，逐个查过的：霞鹜文楷没有
 * 400，中文包一个真斜体都没有。照着「反正都有 400」写会直接 404。
 */
export const PACKAGES: Readonly<Record<string, FontPackage>> = {
  Carlito: { pkg: '@fontsource/carlito', version: '5.3.0', weights: [400, 700], italics: [400, 700] },
  Caladea: { pkg: '@fontsource/caladea', version: '5.3.0', weights: [400, 700], italics: [400, 700] },
  Arimo: { pkg: '@fontsource/arimo', version: '5.3.0', weights: [400, 500, 600, 700], italics: [400, 500, 600, 700] },
  Tinos: { pkg: '@fontsource/tinos', version: '5.3.0', weights: [400, 700], italics: [400, 700] },
  Cousine: { pkg: '@fontsource/cousine', version: '5.3.0', weights: [400, 700], italics: [400, 700] },
  'Open Sans': { pkg: '@fontsource/open-sans', version: '5.3.0', weights: [300, 400, 500, 600, 700, 800], italics: [300, 400, 500, 600, 700, 800] },
  'Noto Sans SC': { pkg: '@fontsource/noto-sans-sc', version: '5.3.0', weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], italics: [] },
  'Noto Serif SC': { pkg: '@fontsource/noto-serif-sc', version: '5.3.0', weights: [200, 300, 400, 500, 600, 700, 800, 900], italics: [] },
  // 霞鹜文楷只出 Light / Regular / Bold 三档，没有 400
  'LXGW WenKai': { pkg: '@fontsource/lxgw-wenkai', version: '5.3.0', weights: [300, 500, 700], italics: [] },
};

/** 就近取一个该包真有的字重；差值相同时取更细的那一档 */
function nearest(weights: readonly number[], want: number): number | null {
  let best: number | null = null;
  for (const w of weights) {
    if (best === null || Math.abs(w - want) < Math.abs(best - want)) best = w;
  }
  return best;
}

/**
 * 一个字重 / 斜体的 CSS 地址。
 *
 * 取 fontsource 的**按字重**入口（`400.css`）而不是 `index.css`：后者把九个
 * 字重的声明全塞进来，光解析就上百 KB，而实际用到的通常只有正文和标题两个。
 */
export function cssUrl(family: string, weight: number, italic: boolean, base = DEFAULT_BASE): string | null {
  const p = PACKAGES[family];
  if (!p) return null;
  // 请求的字重不一定存在（霞鹜文楷就没有 400），取最近的一档；
  // 没有真斜体时退回正体，让浏览器自己做倾斜合成——去下一份不存在的文件只会 404
  const list = italic ? p.italics : p.weights;
  const w = nearest(list.length ? list : p.weights, weight);
  if (w === null) return null;
  const useItalic = italic && p.italics.includes(w);
  return `${base}/${p.pkg}@${p.version}/${w}${useItalic ? '-italic' : ''}.css`;
}
