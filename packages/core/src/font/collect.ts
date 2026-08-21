/**
 * 统计一份演示文稿到底用了哪些字体、每个字体要渲染哪些字。
 *
 * 建在**统一 Schema** 上而不是 OOXML 上：主题字体方案、母版/版式继承、
 * `+mn-lt` 这类引用，解析阶段早就收敛进 `TextRun.fonts` 了；建在这里，
 * `.ppt` 链路一行不改就同样有这个能力，也不必碰 `document`（Worker 里能跑）。
 *
 * 用途有二：一是按需加载——CJK 字体整包 2MB 起，得知道要哪些字才谈得上省；
 * 二是导出——`<img>` 加载的 SVG 是隔离文档，拿不到页面注册的字体，必须把
 * 命中的那部分内联进去。
 */

import type { Paragraph, Slide, SlideElement, TextBody } from '../types';

/** 一个字体家族的用量 */
export interface FontUsage {
  family: string;
  /** 实际用到的字重 / 斜体组合，没用到的变体不必加载 */
  styles: { bold: boolean; italic: boolean }[];
  /**
   * 需要渲染的字符，去重后按码位升序。
   *
   * 这是个**超集**：一个 run 的 `fonts` 是 latin / ea / cs 三元组，
   * 具体哪个字落到哪一个由浏览器按字形有无决定，解析结果里区分不出来，
   * 于是把整段文字算给这个 run 的每个家族。宁可多要几片切片，
   * 也不能少要——少了就是缺字。
   */
  chars: string;
  /** 该家族覆盖的字符数（含重复），可用来决定先加载谁 */
  count: number;
}

interface Bucket {
  family: string;
  styles: Set<string>;
  chars: Set<string>;
  count: number;
}

function bucketOf(map: Map<string, Bucket>, family: string): Bucket {
  let b = map.get(family);
  if (!b) {
    b = { family, styles: new Set(), chars: new Set(), count: 0 };
    map.set(family, b);
  }
  return b;
}

function addPara(map: Map<string, Bucket>, p: Paragraph): void {
  for (const run of p.runs) {
    if (!run.text || !run.fonts.length) continue;
    for (const family of run.fonts) {
      const b = bucketOf(map, family);
      b.styles.add(`${run.b ? 1 : 0}${run.i ? 1 : 0}`);
      for (const ch of run.text) b.chars.add(ch);
      b.count += run.text.length;
    }
  }
  // 项目符号有自己的字体；符号字体（Wingdings 之类）渲染层本来就换成了 •，
  // 这里也没必要为它去要一份网络字体
  if (p.bullet && p.bulletFont && !/wingdings|webdings|symbol/i.test(p.bulletFont)) {
    const b = bucketOf(map, p.bulletFont);
    b.styles.add('00');
    for (const ch of p.bullet) b.chars.add(ch);
    b.count += p.bullet.length;
  }
}

function addBody(map: Map<string, Bucket>, t: TextBody | null | undefined): void {
  for (const p of t?.paragraphs ?? []) addPara(map, p);
}

function walk(map: Map<string, Bucket>, els: SlideElement[]): void {
  for (const el of els) {
    switch (el.kind) {
      case 'shape':
        addBody(map, el.text);
        break;
      case 'group':
        walk(map, el.children);
        break;
      case 'table':
        for (const row of el.rows) for (const cell of row.cells) addBody(map, cell.text);
        break;
    }
  }
}

/**
 * 统计若干页用到的字体。
 *
 * **按页调用**——`slides` 是惰性解析的，一次性遍历整份会把惰性解析的收益抹掉。
 * 查看器该做的是「当前页 + 预取下一页」，不是开场把 200 页全解析一遍。
 */
export function collectFonts(slides: Iterable<Slide>): FontUsage[] {
  const map = new Map<string, Bucket>();
  for (const slide of slides) walk(map, slide.elements);

  const out: FontUsage[] = [];
  for (const b of map.values()) {
    if (!b.chars.size) continue;
    out.push({
      family: b.family,
      styles: [...b.styles].sort().map((s) => ({ bold: s[0] === '1', italic: s[1] === '1' })),
      chars: [...b.chars].sort((x, y) => x.codePointAt(0)! - y.codePointAt(0)!).join(''),
      count: b.count,
    });
  }
  // 用得最多的排前面：加载有先后时，先让正文字体到位
  return out.sort((a, b) => b.count - a.count || a.family.localeCompare(b.family));
}
