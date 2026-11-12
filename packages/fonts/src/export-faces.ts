/**
 * 导出的「另一半」：把替代字体真正内联进导出产物。
 *
 * 页面预览靠注入 `<style>` + `unicode-range` 按需下载；但 `<img>` 加载的 SVG 是
 * 隔离文档，拿不到页面字体——PNG / 独立 SVG / 打印导出必须把**命中的切片**以
 * data URI 内联。`collectFonts` 返回的字符集正是为此准备的。
 *
 * 这里只挑与用量字符相交的切片，不做整字体下载；家族名写回**原字体名**，
 * 与页面加载同一套替换表与就近字重规则。
 */
import type { EmbeddedFont, FontUsage } from '@web-ppt/core';
import { cssUrl, DEFAULT_BASE } from './sources';
import { substituteFor, type Substitution } from './substitute';
import { fetchCss, isInstalled, LATIN_CHARS } from './load';

export interface ExportFaceOptions {
  /** CDN 基址，默认 jsDelivr；与 loadFontsFor 共用同一约定 */
  base?: string;
  /** 覆盖 / 扩充内置替换表，键为小写后的原字体名 */
  overrides?: Readonly<Record<string, Substitution>>;
  /**
   * 本机已装原字体时跳过，默认**关**（与 loadFontsFor 相反）：预览看的是本机，
   * 导出文件要在**收件人**的机器上打开，导出方装没装不构成跳过的理由。
   */
  skipInstalled?: boolean;
  /** 与 loadFontsFor 的 cjk 同义：关掉后中文家族不内联 */
  cjk?: boolean;
  /** isInstalled 的探测目标，默认当前文档 */
  document?: Document;
  /** 内联不完整时的观察口；reason 稳定 */
  onIssue?: (info: { family: string; reason: 'css-unavailable' | 'slice-unavailable' }) => void;
}

/* ── unicode-range 解析与命中 ─────────────────── */

/** `U+4E00-9FFF, U+30??` → 码位区间列表；解析不了的段直接丢弃 */
function parseRanges(text: string): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  for (const part of text.split(',')) {
    const m = part.trim().match(/^U\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?$/i);
    if (!m) continue;
    out.push([
      Number.parseInt(m[1].replace(/\?/g, '0'), 16),
      m[2] === undefined ? Number.parseInt(m[1].replace(/\?/g, 'F'), 16) : Number.parseInt(m[2], 16),
    ]);
  }
  return out;
}

/** 区间是否覆盖用量的任一字符 */
function coversAnyChar(ranges: readonly (readonly [number, number])[], chars: string): boolean {
  for (const ch of chars) {
    const cp = ch.codePointAt(0)!;
    if (ranges.some(([low, high]) => cp >= low && cp <= high)) return true;
  }
  return false;
}

/**
 * 从切片声明里取出规范化的 `unicode-range` 值。
 *
 * 输出按解析结果重新序列化（`U+XXXX-YYYY,...`）——原始 CSS 文本不能原样进导出
 * SVG，否则一段恶意 CSS 就能注入任意声明。没有 range 的声明返回 null（全覆盖）。
 */
function blockRange(block: string): string | null {
  const raw = block.match(/unicode-range:\s*([^;}]*)/)?.[1];
  if (!raw) return null;
  const ranges = parseRanges(raw);
  if (!ranges.length) return null;
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');
  return ranges.map(([low, high]) => `U+${hex(low)}-${hex(high)}`).join(',');
}

/* ── 切片字节 → data URI ─────────────────────── */

const sliceCache = new Map<string, Promise<string | null>>();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  // String.fromCharCode 的展开参数有长度上限，分块转
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function fetchSlice(url: string): Promise<string | null> {
  let job = sliceCache.get(url);
  if (!job) {
    job = fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return `data:font/woff2;base64,${toBase64(new Uint8Array(await response.arrayBuffer()))}`;
    }).catch(() => null).then((uri) => {
      // 短时网络失败不永久缓存；同一导出会话内命中过的切片保持免费
      if (uri === null) sliceCache.delete(url);
      return uri;
    });
    sliceCache.set(url, job);
  }
  return job;
}

/* ── 主流程 ───────────────────────────────────── */

async function facesForUsage(
  usage: FontUsage,
  opts: ExportFaceOptions,
): Promise<EmbeddedFont[]> {
  const sub = substituteFor(usage.family, opts.overrides);
  if (!sub) return [];
  if (sub.cjk && opts.cjk === false) return [];
  if (opts.skipInstalled && opts.document && isInstalled(usage.family, opts.document)) return [];

  // 与 loadFontsFor 同一套字重选择：CJK 没有真斜体，一律退正体由收件方合成
  const wanted = new Set<string>();
  for (const st of usage.styles) {
    wanted.add(`${st.bold ? 700 : 400}|${sub.cjk ? false : st.italic}`);
  }

  const faces: EmbeddedFont[] = [];
  for (const key of wanted) {
    const [w, it] = key.split('|');
    const weight = Number(w), bold = weight === 700, italic = it === 'true';
    const families = [sub.family, ...(sub.latinFamily && LATIN_CHARS.test(usage.chars) ? [sub.latinFamily] : [])];
    for (const family of families) {
      const href = cssUrl(family, weight, italic, opts.base ?? DEFAULT_BASE);
      if (!href) continue;
      const css = await fetchCss(href);
      if (!css) {
        opts.onIssue?.({ family: usage.family, reason: 'css-unavailable' });
        continue;
      }
      const adjust = sub.latinSizeAdjust && family === sub.latinFamily ? sub.latinSizeAdjust : undefined;
      let underscoreSrc: string | null = null;
      for (const block of css.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
        const range = blockRange(block);
        if (range && !coversAnyChar(parseRanges(range), usage.chars)) continue;
        const rel = block.match(/url\(([^)]+)\)/)?.[1]?.replace(/^['"]|['"]$/g, '');
        if (!rel) continue;
        const url = rel.startsWith('./') ? `${href.slice(0, href.lastIndexOf('/') + 1)}${rel.slice(2)}` : rel;
        const data = await fetchSlice(url);
        if (!data) {
          opts.onIssue?.({ family: usage.family, reason: 'slice-unavailable' });
          continue;
        }
        // 粗体的西文替代整体缩放，拉齐原字体的前进宽度（与页面加载同一组实测值）
        if (adjust && bold) {
          faces.push({ family: usage.family, src: data, bold, italic, unicodeRange: range ?? undefined, sizeAdjust: adjust.bold });
        } else {
          faces.push({ family: usage.family, src: data, bold, italic, unicodeRange: range ?? undefined });
        }
        // 下划线要单独一张 U+5F 的面再缩一次；声明顺序在后，匹配时覆盖整体面
        if (adjust && range && coversAnyChar(parseRanges(range), '_')) underscoreSrc = data;
      }
      if (adjust && underscoreSrc && usage.chars.includes('_')) {
        faces.push({ family: usage.family, src: underscoreSrc, bold, italic, unicodeRange: 'U+5F', sizeAdjust: adjust.underscore });
      }
    }
  }
  return faces;
}

/**
 * 为导出准备替代字体的内联脸集：只含与用量字符相交的切片，data URI 直取直用。
 *
 * 返回顺序稳定（按 usages 顺序），导出产物字节确定。结果作为导出选项
 * `fonts.extraFontFaces` 传给 core；core 的子集化引擎不会动这些切片
 * （它们已经是按 unicode-range 切好的最小单元，且多为 woff2）。
 */
export async function exportFontFaces(
  usages: readonly FontUsage[],
  opts: ExportFaceOptions = {},
): Promise<EmbeddedFont[]> {
  if (typeof fetch !== 'function') return [];
  // 逐个用量收集后按原顺序展平：Promise.all 的完成顺序不能进入产物
  const perUsage = await Promise.all(usages.map((usage) => facesForUsage(usage, opts)));
  return perUsage.flat();
}
