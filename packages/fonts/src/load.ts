import type { FontUsage } from '@web-ppt/core';
import { cssUrl, DEFAULT_BASE } from './sources';
import { substituteFor, type Substitution } from './substitute';

/**
 * 把「这份文件用了哪些字体」变成「浏览器真的能按它排版」。
 *
 * 三件事，缺一不可：
 *   1. 本机装了原字体就什么都不做——零下载永远优于任何加载策略；
 *   2. 没装就取替代字体的 `@font-face`，**把家族名改写成原字体名**。
 *      不改写没用：幻灯片里写的是「微软雅黑」，CSS 里没有别名机制，
 *      只有让 `@font-face` 顶着「微软雅黑」这个名字，那段文字才会用上它；
 *   3. `src` 开头补一条 `local()`。声明了同名 `@font-face` 会**盖掉**系统里
 *      的同名字体，不补这一条，装了原字体的人反而被拖去下载替代品。
 *
 * 按需下载完全交给 `unicode-range`：fontsource 的 CSS 自带切片划分，
 * 浏览器只取真正渲染到的那几片。我们不重切、不预测。
 */

export interface LoadOptions {
  /** CDN 基址，默认 jsDelivr */
  base?: string;
  /** 覆盖 / 扩充内置替换表，键为小写后的原字体名 */
  overrides?: Readonly<Record<string, Substitution>>;
  /** 本机已装的字体不替换（默认开启）。关掉可强制统一到替代字体 */
  skipInstalled?: boolean;
  /**
   * 是否替换中日韩字体，默认开启——传进来的用量本来就该全部处理，
   * 半路砍掉一半才是意外。
   *
   * 但代价要心里有数，这是实测的：一页只有 22 个不同汉字，却要跨 18 个切片、
   * 下 553KB。切片一片约 30KB 装约 160 个码位，用掉一两个也得整片下，
   * 整份中文文件收敛下来在 1MB 上下。拉丁则一个字重才十几 KB。
   *
   * 关掉它的正当理由：流量敏感的场景，或者判断「系统自带中文字体已经够看」——
   * 汉字全角等宽，换字形不改断行，视觉收益确实比拉丁那边小得多。
   */
  cjk?: boolean;
  /** 目标文档，默认当前文档；渲染到 iframe 时要传 */
  document?: Document;
}

/** 一个家族的处理结果 */
export interface LoadResult {
  family: string;
  /**
   * `installed` 本机已有 · `substituted` 已换成替代字体 ·
   * `skipped-cjk` 是中文字体且调用方关了 `cjk` · `unmapped` 表里没有 · `failed` 取不到
   */
  status: 'installed' | 'substituted' | 'skipped-cjk' | 'unmapped' | 'failed';
  /** 实际下载的替代字体家族 */
  substitute?: string;
}

/* ── 本机字体探测 ─────────────────────────────── */

let probeCtx: CanvasRenderingContext2D | null = null;
let probed = false;

/**
 * `document.fonts.check()` 测不出可用性——对没注册过的字体它一律返回 true。
 * 只能用宽度探针：同一串字分别用「候选 + 兜底」和「纯兜底」量，
 * 宽度一样就说明候选没生效。
 *
 * 探测上下文只建一次：Node / jsdom / 反指纹浏览器里 `getContext('2d')` 恒为 null，
 * 不缓存这个结论就会在每次探测时新建一个 canvas。
 */
function ctx(doc: Document): CanvasRenderingContext2D | null {
  if (probed) return probeCtx;
  probed = true;
  try {
    const g = doc.createElement('canvas').getContext('2d');
    probeCtx = g && typeof g.measureText === 'function' ? g : null;
  } catch {
    probeCtx = null;
  }
  return probeCtx;
}

const PROBE_TEXT = 'MMMMHHHHiiiill漢字語';

/** 本机是否装了这个字体。量不出来时保守地当作「没装」，走替换路径 */
export function isInstalled(family: string, doc: Document = globalThis.document): boolean {
  const g = ctx(doc);
  if (!g) return false;
  // 两种风格迥异的兜底都比一遍，避免候选字体恰好与某一种等宽而被误判
  for (const generic of ['monospace', 'serif']) {
    g.font = `72px ${generic}`;
    const base = g.measureText(PROBE_TEXT).width;
    g.font = `72px '${family.replace(/'/g, '')}', ${generic}`;
    if (Math.abs(g.measureText(PROBE_TEXT).width - base) > 0.5) return true;
  }
  return false;
}

/* ── @font-face 改写 ──────────────────────────── */

/**
 * 把 fontsource 的 CSS 改造成「顶着原字体名」的 `@font-face`。
 *
 * 两处改写：家族名换成 `original`，相对路径 `./files/x.woff2` 换成绝对地址
 * （我们是把 CSS 文本注入到页面里，相对路径会按页面地址解析，必然 404）。
 * `unicode-range` 原样保留——按需下载全靠它。
 */
export function rewriteFontFaceCss(
  css: string,
  original: string,
  cssHref: string,
  opts: { readonly preferLocal?: boolean } = {},
): string {
  const dir = cssHref.slice(0, cssHref.lastIndexOf('/') + 1);
  const name = original.replace(/['\\]/g, '');
  const rewritten = css
    .replace(/font-family:\s*'[^']*'/g, `font-family: '${name}'`)
    .replace(/url\(\.\/([^)]+)\)/g, (_m, rel: string) => `url(${dir}${rel})`);
  // 系统里有同名字体就直接用系统的，一个字节都不下
  return opts.preferLocal === false ? rewritten : rewritten.replace(/src:\s*url\(/g, `src: local('${name}'), url(`);
}

function coversCodePoint(block: string, codePoint: number): boolean {
  const ranges = block.match(/unicode-range:\s*([^;}]*)/)?.[1];
  if (!ranges) return true;
  return ranges.split(',').some((part) => {
    const [from, to = from] = part.trim().replace(/^U\+/i, '').split('-');
    const low = parseInt(from.replace(/\?/g, '0'), 16);
    const high = parseInt(to.replace(/\?/g, 'F'), 16);
    return codePoint >= low && codePoint <= high;
  });
}

/**
 * 把西文替代字体的前进宽度拉向原字体：粗体的每条声明加 size-adjust；覆盖下划线的那条声明
 * 再复制一份只含 U+5F 的面单独缩放。同字重的面按声明逆序匹配 unicode-range，所以下划线面
 * 必须追加在最后。它按替代字体自己的度量缩放，调用方不能再让 local(原字体名) 抢先命中。
 */
function adjustLatinFaceCss(
  css: string,
  weight: number,
  adjust: { readonly bold: number; readonly underscore: number },
): string {
  const blocks = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  const sized = (block: string, percent: number): string => block.replace(/\s*\}$/, `\n  size-adjust: ${percent}%;\n}`);
  const out = weight >= 600 ? blocks.map((block) => sized(block, adjust.bold)) : [...blocks];
  const underscore = blocks.find((block) => coversCodePoint(block, 0x5f));
  if (underscore) {
    const only = /unicode-range:/.test(underscore)
      ? underscore.replace(/unicode-range:\s*[^;}]*/, 'unicode-range: U+5F')
      : underscore.replace(/\s*\}$/, '\n  unicode-range: U+5F;\n}');
    out.push(sized(only, adjust.underscore));
  }
  return out.join('\n');
}

/* ── 主流程 ───────────────────────────────────── */

const injected = new Set<string>();
const cssCache = new Map<string, Promise<string | null>>();
const LATIN_CHARS = /[\u0000-\u024f\u1e00-\u1eff\u2000-\u206f]/;

async function fetchCss(url: string): Promise<string | null> {
  let job = cssCache.get(url);
  if (!job) {
    job = fetch(url).then((r) => (r.ok ? r.text() : null)).catch(() => null).then((css) => {
      // 短时网络失败不应永久缓存成“该字重不存在”；下一页仍可重试。
      if (css === null) cssCache.delete(url);
      return css;
    });
    cssCache.set(url, job);
  }
  return job;
}

/**
 * 为一份演示文稿的字体用量准备好网络字体。
 *
 * 返回后调用方应当**重新渲染当前页**：排版是同步的、字体加载是异步的，
 * 首帧必然是按回退字体断的行。`foreignObject` 路径由浏览器重排，原生
 * `<text>` 路径则要重新量字宽——两条路都得重渲才对得上。
 */
export async function loadFontsFor(usages: readonly FontUsage[], opts: LoadOptions = {}): Promise<LoadResult[]> {
  const doc = opts.document ?? globalThis.document;
  const base = opts.base ?? DEFAULT_BASE;
  const skipInstalled = opts.skipInstalled !== false;
  if (!doc || typeof fetch !== 'function') return [];

  const jobs = usages.map(async (usage): Promise<LoadResult> => {
    const { family } = usage;
    // 已注入的网页字体会改变探针宽度，不能拿它当“本机已装原字体”，否则翻页后
    // 新遇到的字重与字形永远不会加载。
    const alreadyInjected = [...injected].some((tag) => tag.startsWith(`${family}|`));
    if (skipInstalled && !alreadyInjected && isInstalled(family, doc)) return { family, status: 'installed' };

    const sub = substituteFor(family, opts.overrides);
    if (!sub) return { family, status: 'unmapped' };
    if (sub.cjk && opts.cjk === false) return { family, status: 'skipped-cjk' };

    // 只取实际用到的字重 / 斜体组合。CJK 没有真斜体，斜体一律退回正体，
    // 让浏览器自己做倾斜合成——去下一份根本不存在的斜体文件只会 404
    const wanted = new Set<string>();
    for (const st of usage.styles) {
      const weight = st.bold ? 700 : 400;
      wanted.add(`${weight}|${sub.cjk ? false : st.italic}`);
    }

    let ok = false;
    for (const key of wanted) {
      const [w, it] = key.split('|');
      const faces = [sub.family, ...(sub.latinFamily && LATIN_CHARS.test(usage.chars) ? [sub.latinFamily] : [])];
      for (const face of faces) {
        const href = cssUrl(face, Number(w), it === 'true', base);
        if (!href) continue;
        const tag = `${family}|${key}|${face}`;
        if (injected.has(tag)) continue;
        const css = await fetchCss(href);
        if (!css) continue;
        injected.add(tag);
        const style = doc.createElement('style');
        style.dataset.webPptFont = family;
        // 西文声明也属于这次 CJK 替换；关闭中文替换时两条声明必须一起撤回。
        if (sub.cjk) style.dataset.webPptCjk = '1';
        const adjust = face === sub.latinFamily ? sub.latinSizeAdjust : undefined;
        const rewritten = rewriteFontFaceCss(css, family, href, { preferLocal: !adjust });
        style.textContent = adjust ? adjustLatinFaceCss(rewritten, Number(w), adjust) : rewritten;
        doc.head.appendChild(style);
      }

      // 必须把用到的字一起传进去：只给家族名的话，浏览器不知道该取哪几片切片，
      // CJK 会一片都不下
      try {
        await doc.fonts.load(`${it === 'true' ? 'italic ' : ''}${w} 16px '${family}'`, usage.chars);
        ok = true;
      } catch {
        /* 单个字重取不到不影响其它 */
      }
    }
    return ok ? { family, status: 'substituted', substitute: sub.family } : { family, status: 'failed' };
  });

  return Promise.all(jobs);
}

/**
 * 撤回已注入的 `@font-face`。
 *
 * 给「用户中途关掉替换」用。只撤声明，不动浏览器已缓存的字节——再打开时
 * 那些切片是免费的。撤完宿主要自己重渲当前页。
 */
export function unloadFonts(opts: { cjkOnly?: boolean; document?: Document } = {}): void {
  const doc = opts.document ?? globalThis.document;
  if (!doc) return;
  const sel = opts.cjkOnly ? 'style[data-web-ppt-cjk]' : 'style[data-web-ppt-font]';
  for (const el of doc.querySelectorAll<HTMLStyleElement>(sel)) {
    for (const tag of [...injected]) {
      if (tag.startsWith(`${el.dataset.webPptFont}|`)) injected.delete(tag);
    }
    el.remove();
  }
}
