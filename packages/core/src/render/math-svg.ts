/**
 * 数学公式排版 —— 公式树 → 定位好的 SVG 片段。
 *
 * 箱模型：每个节点算出 (w, h, d)，h 是基线以上高度、d 是基线以下深度。
 * 父节点据此对齐子箱，最后一次性平移出绝对坐标。这是 TeX 的做法，
 * 也是唯一能让分式套根式套上标还保持基线正确的做法。
 *
 * 只依赖 types.ts 与一个注入的测量函数，与文件格式无关。
 */

import type { MathNode } from '../types';

/** 测量函数：给定文本与字号（px），返回宽度 */
export type MeasureFn = (text: string, size: number, italic: boolean, bold: boolean) => number;

export interface Box {
  w: number;
  /** 基线以上 */
  h: number;
  /** 基线以下 */
  d: number;
  /** 以 (x, 基线y) 为原点绘制 */
  draw: (x: number, y: number) => string;
}

const MATH_FONT = "'Cambria Math','Latin Modern Math','STIX Two Math','Times New Roman',serif";

const r = (v: number): string => String(Math.round(v * 100) / 100);
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * 组合附加符号（U+03xx / U+20Dx）→ 间隔字符。
 *
 * OMML 的 m:acc@chr 存的是组合码位，它们本该附着在前一个字符上；
 * 单独当一个 <text> 画出来，浏览器要么画成点状圈里的符号、要么位置漂移。
 * 我们是自己定位的，需要的是有实体宽度的间隔形式。
 */
const SPACING_ACCENT: Record<string, string> = {
  '\u0300': '\u02cb', '\u0301': '\u02ca', '\u0302': '\u02c6', '\u0303': '\u02dc',
  '\u0306': '\u02d8', '\u0307': '\u02d9', '\u0308': '\u00a8', '\u030a': '\u02da',
  '\u030c': '\u02c7', '\u20d6': '\u2190', '\u20d7': '\u2192', '\u20e1': '\u2194',
  '\u20db': '\u22ef', '\u20dc': '\u22ef',
};

/** 画成横线而非字形的重音（上划线 / 下划线各种写法） */
const LINE_ACCENT = new Set(['\u0305', '\u0304', '\u203e', '\u00af', '\u0332', '\u0333', '_']);

/** 需要横向拉伸到底宽的括号类符号（groupChr） */
const STRETCH_ACCENT = new Set(['\u23de', '\u23df', '\u23b4', '\u23b5', '\u23dc', '\u23dd']);

/** 脚标相对底的字号比例；连续两级后不再缩小，与 TeX 的 scriptscript 一致 */
const SCRIPT = 0.72;
const MIN_SCALE = 0.5;

interface Ctx {
  size: number;
  measure: MeasureFn;
  color: string;
}

const sub = (ctx: Ctx, factor: number): Ctx =>
  ({ ...ctx, size: Math.max(ctx.size * factor, ctx.size * MIN_SCALE) });

function empty(): Box {
  return { w: 0, h: 0, d: 0, draw: () => '' };
}

/** 字形相对字号的经验上伸 / 下伸；实际度量拿不到，只能取通用比例 */
const ASC = 0.72;
const DESC = 0.22;

function textSvg(text: string, ctx: Ctx, italic: boolean, bold: boolean, x: number, y: number, tf = ''): string {
  const style = `font-family:${MATH_FONT};font-size:${r(ctx.size)}px;` +
    (italic ? 'font-style:italic;' : '') + (bold ? 'font-weight:700;' : '');
  return tf
    ? `<text x="0" y="0" style="${style}" fill="${ctx.color}" xml:space="preserve" transform="${tf}">${esc(text)}</text>`
    : `<text x="${r(x)}" y="${r(y)}" style="${style}" fill="${ctx.color}" xml:space="preserve">${esc(text)}</text>`;
}

function glyph(text: string, ctx: Ctx, italic: boolean, bold: boolean): Box {
  return {
    w: ctx.measure(text, ctx.size, italic, bold),
    h: ctx.size * ASC,
    d: ctx.size * DESC,
    draw: (x, y) => textSvg(text, ctx, italic, bold, x, y),
  };
}

/**
 * 可伸缩定界符：把字形的自然范围精确映射到 [-h, +d]。
 *
 * 不能简单地绕基线 scale——矩阵这类内容上下不对称（整体压在数学轴上），
 * 绕基线等比放大会让括号下缘冲出内容一大截。所以先缩放再平移对中心。
 */
function stretchyDelim(chr: string, ctx: Ctx, h: number, d: number): Box {
  const g = glyph(chr, ctx, false, false);
  const natural = ctx.size * (ASC + DESC);
  const need = h + d;
  if (need <= natural * 1.02) return g;
  const k = need / natural;
  // 缩放绕基线进行，缩放后中心在 -0.25·size·k，平移到目标中心
  const dy = (d - h) / 2 + ((ASC - DESC) / 2) * ctx.size * k;
  return {
    w: g.w,
    h,
    d,
    draw: (x, y) => textSvg(chr, ctx, false, false, 0, 0,
      `translate(${r(x)} ${r(y + dy)}) scale(1 ${r(k)})`),
  };
}

function rule(w: number, thickness: number, color: string): Box {
  return {
    w,
    h: thickness,
    d: 0,
    draw: (x, y) => `<rect x="${r(x)}" y="${r(y - thickness)}" width="${r(w)}" height="${r(thickness)}" fill="${color}"/>`,
  };
}

/** 横向拼接：基线对齐 */
function hbox(boxes: Box[]): Box {
  if (!boxes.length) return empty();
  const w = boxes.reduce((s, b) => s + b.w, 0);
  const h = Math.max(...boxes.map((b) => b.h));
  const d = Math.max(...boxes.map((b) => b.d));
  return {
    w,
    h,
    d,
    draw: (x, y) => {
      let cx = x;
      const out: string[] = [];
      for (const b of boxes) { out.push(b.draw(cx, y)); cx += b.w; }
      return out.join('');
    },
  };
}

/** 纵向堆叠并居中；baselineAt 指定第几行作为整体基线所在行 */
function vbox(boxes: Box[], gap: number, baselineIdx: number): Box {
  if (!boxes.length) return empty();
  const w = Math.max(...boxes.map((b) => b.w));
  let above = 0, below = 0;
  boxes.forEach((b, i) => {
    if (i < baselineIdx) above += b.h + b.d + gap;
    else if (i === baselineIdx) { above += b.h; below += b.d; }
    else below += b.h + b.d + gap;
  });
  return {
    w,
    h: above,
    d: below,
    draw: (x, y) => {
      let cy = y - above;
      const out: string[] = [];
      for (const b of boxes) {
        cy += b.h;
        out.push(b.draw(x + (w - b.w) / 2, cy));
        cy += b.d + gap;
      }
      return out.join('');
    },
  };
}

function layoutList(nodes: MathNode[], ctx: Ctx): Box {
  return hbox(nodes.map((n) => layoutNode(n, ctx)));
}

function layoutNode(node: MathNode, ctx: Ctx): Box {
  switch (node.kind) {
    case 'run': {
      const sty = node.sty ?? 'i';
      // 数字与运算符即使标了斜体也该直立——这是数学排版的通行约定
      const allDigits = /^[\d\s.,+\-=<>()[\]{}|/*]+$/.test(node.text);
      return glyph(node.text, ctx, (sty === 'i' || sty === 'bi') && !allDigits, sty === 'b' || sty === 'bi');
    }

    case 'frac': {
      if (node.type === 'lin') {
        return hbox([layoutList(node.num, ctx), glyph('/', ctx, false, false), layoutList(node.den, ctx)]);
      }
      if (node.type === 'skw') {
        const c = sub(ctx, 0.85);
        return hbox([layoutList(node.num, c), glyph('⁄', ctx, false, false), layoutList(node.den, c)]);
      }
      const c = sub(ctx, 0.9);
      const num = layoutList(node.num, c);
      const den = layoutList(node.den, c);
      const pad = ctx.size * 0.22;
      const w = Math.max(num.w, den.w) + pad * 2;
      const th = Math.max(0.6, ctx.size * 0.055);
      // 分数线压在数学轴上（约 x 高度的一半），不是压在基线上
      const axis = ctx.size * 0.28;
      const gap = ctx.size * 0.18;
      const h = axis + th + gap + num.h + num.d;
      const d = -axis + th + gap + den.h + den.d;
      return {
        w,
        h,
        d,
        draw: (x, y) => {
          const barY = y - axis;
          const out = [
            num.draw(x + (w - num.w) / 2, barY - gap - num.d),
            den.draw(x + (w - den.w) / 2, barY + th + gap + den.h),
          ];
          if (node.type !== 'noBar') {
            out.push(`<rect x="${r(x + pad * 0.4)}" y="${r(barY)}" width="${r(w - pad * 0.8)}" height="${r(th)}" fill="${ctx.color}"/>`);
          }
          return out.join('');
        },
      };
    }

    case 'rad': {
      const base = layoutList(node.base, ctx);
      const th = Math.max(0.6, ctx.size * 0.05);
      const gap = ctx.size * 0.12;
      const hookW = ctx.size * 0.55;
      const deg = node.deg.length ? layoutList(node.deg, sub(ctx, 0.55)) : null;
      const degW = deg ? Math.max(0, deg.w - hookW * 0.35) : 0;
      const h = base.h + gap + th;
      const d = base.d;
      const w = degW + hookW + base.w + ctx.size * 0.12;
      return {
        w,
        h: Math.max(h, deg ? h + deg.h * 0.3 : h),
        d,
        draw: (x, y) => {
          const x0 = x + degW;
          const top = y - h;
          const bot = y + d;
          // 根号：短撇 + 长斜 + 顶横线，一笔折线画完
          const path = `M ${r(x0)} ${r(bot - (bot - top) * 0.45)} L ${r(x0 + hookW * 0.3)} ${r(bot - (bot - top) * 0.3)} ` +
            `L ${r(x0 + hookW * 0.62)} ${r(bot)} L ${r(x0 + hookW)} ${r(top)} L ${r(x + w)} ${r(top)}`;
          const out = [
            `<path d="${path}" fill="none" stroke="${ctx.color}" stroke-width="${r(th)}" stroke-linejoin="miter"/>`,
            base.draw(x0 + hookW + ctx.size * 0.06, y),
          ];
          if (deg) out.push(deg.draw(x, y - (bot - top) * 0.42));
          return out.join('');
        },
      };
    }

    case 'script': {
      const base = node.base.length ? layoutList(node.base, ctx) : empty();
      const c = sub(ctx, SCRIPT);
      const supB = node.sup?.length ? layoutList(node.sup, c) : null;
      const subB = node.sub?.length ? layoutList(node.sub, c) : null;
      const shiftUp = ctx.size * 0.42;
      const shiftDown = ctx.size * 0.22;
      const w = base.w + Math.max(supB?.w ?? 0, subB?.w ?? 0) + ctx.size * 0.04;
      return {
        w,
        h: Math.max(base.h, supB ? shiftUp + supB.h : 0),
        d: Math.max(base.d, subB ? shiftDown + subB.d : 0),
        draw: (x, y) => {
          const out = [base.draw(x, y)];
          const sx = x + base.w + ctx.size * 0.02;
          if (supB) out.push(supB.draw(sx, y - shiftUp));
          if (subB) out.push(subB.draw(sx, y + shiftDown));
          return out.join('');
        },
      };
    }

    case 'nary': {
      const big = { ...ctx, size: ctx.size * 1.45 };
      const op = glyph(node.chr, big, false, false);
      const c = sub(ctx, SCRIPT);
      const supB = node.sup.length ? layoutList(node.sup, c) : null;
      const subB = node.sub.length ? layoutList(node.sub, c) : null;
      const base = layoutList(node.base, ctx);

      if (node.underOver) {
        const stack: Box[] = [];
        if (supB) stack.push(supB);
        stack.push(op);
        if (subB) stack.push(subB);
        const opCol = vbox(stack, ctx.size * 0.08, supB ? 1 : 0);
        return hbox([opCol, { ...empty(), w: ctx.size * 0.12 }, base]);
      }
      const shiftUp = ctx.size * 0.55;
      const shiftDown = ctx.size * 0.45;
      const scriptW = Math.max(supB?.w ?? 0, subB?.w ?? 0);
      const opWithScripts: Box = {
        w: op.w + scriptW + ctx.size * 0.06,
        h: Math.max(op.h, supB ? shiftUp + supB.h : 0),
        d: Math.max(op.d, subB ? shiftDown + subB.d : 0),
        draw: (x, y) => {
          const out = [op.draw(x, y)];
          if (supB) out.push(supB.draw(x + op.w + ctx.size * 0.04, y - shiftUp));
          if (subB) out.push(subB.draw(x + op.w + ctx.size * 0.04, y + shiftDown));
          return out.join('');
        },
      };
      return hbox([opWithScripts, { ...empty(), w: ctx.size * 0.1 }, base]);
    }

    case 'delim': {
      const inner: Box[] = [];
      node.items.forEach((item, i) => {
        if (i > 0 && node.sep) inner.push(glyph(node.sep, ctx, false, false));
        inner.push(layoutList(item, ctx));
      });
      const body = hbox(inner);
      // 括号略高于内容，是排版惯例：贴着内容画会显得夹得太紧
      const pad = ctx.size * 0.06;
      const dh = Math.max(body.h + pad, ctx.size * ASC);
      const dd = Math.max(body.d + pad, ctx.size * DESC);
      const beg = node.beg && node.beg !== ' ' ? stretchyDelim(node.beg, ctx, dh, dd) : null;
      const end = node.end && node.end !== ' ' ? stretchyDelim(node.end, ctx, dh, dd) : null;
      const parts = [beg, body, end].filter((b): b is Box => b !== null);
      const w = parts.reduce((s, b) => s + b.w, 0);
      return {
        w,
        h: Math.max(body.h, beg ? beg.h : 0),
        d: Math.max(body.d, beg ? beg.d : 0),
        draw: (x, y) => {
          let cx = x;
          const out: string[] = [];
          for (const b of parts) { out.push(b.draw(cx, y)); cx += b.w; }
          return out.join('');
        },
      };
    }

    case 'matrix': {
      const cells = node.rows.map((row) => row.map((c) => layoutList(c, ctx)));
      const cols = Math.max(0, ...cells.map((r2) => r2.length));
      const colW: number[] = [];
      for (let i = 0; i < cols; i++) colW.push(Math.max(0, ...cells.map((row) => row[i]?.w ?? 0)));
      const colGap = ctx.size * 0.5;
      const rowGap = ctx.size * 0.35;
      const rowH = cells.map((row) => Math.max(ctx.size * 0.72, ...row.map((b) => b.h)));
      const rowD = cells.map((row) => Math.max(ctx.size * 0.22, ...row.map((b) => b.d)));
      const w = colW.reduce((s, v) => s + v, 0) + colGap * Math.max(0, cols - 1);
      const total = rowH.reduce((s, v, i) => s + v + rowD[i], 0) + rowGap * Math.max(0, cells.length - 1);
      const axis = ctx.size * 0.28;
      return {
        w,
        h: total / 2 + axis,
        d: total / 2 - axis,
        draw: (x, y) => {
          const out: string[] = [];
          let cy = y - (total / 2 + axis);
          cells.forEach((row, ri) => {
            cy += rowH[ri];
            let cx = x;
            row.forEach((b, ci) => {
              out.push(b.draw(cx + (colW[ci] - b.w) / 2, cy));
              cx += colW[ci] + colGap;
            });
            cy += rowD[ri] + rowGap;
          });
          return out.join('');
        },
      };
    }

    case 'acc': {
      const base = layoutList(node.base, ctx);
      const markSize = ctx.size * 0.9;
      const raw = node.chr.trim();
      const th = Math.max(0.6, ctx.size * 0.05);
      // 横线贴得近，字形（帽 / 箭头）要多留一点，否则压在字母上
      const gap = ctx.size * (LINE_ACCENT.has(node.chr) || LINE_ACCENT.has(node.chr.trim()) ? 0.06 : 0.02);
      let mark: Box;
      if (LINE_ACCENT.has(node.chr) || LINE_ACCENT.has(raw)) {
        mark = rule(base.w, th, ctx.color);
      } else if (STRETCH_ACCENT.has(raw)) {
        // 花括号 / 方括号类要横向铺满底宽，否则一个窄符号顶着一长串内容
        const g = glyph(raw, { ...ctx, size: markSize }, false, false);
        const sx = g.w > 0 ? base.w / g.w : 1;
        mark = {
          w: base.w,
          h: g.h,
          d: g.d,
          draw: (x, y) => `<g transform="translate(${r(x)} ${r(y)}) scale(${r(sx)} 1)">${g.draw(0, 0)}</g>`,
        };
      } else {
        const chr = SPACING_ACCENT[raw] ?? SPACING_ACCENT[node.chr] ?? (raw || '^');
        const g = glyph(chr, { ...ctx, size: markSize }, false, false);
        // 箭头之类比底宽得多，等比压窄，否则符号左右都甩出底外
        const sx = g.w > base.w * 1.1 && base.w > 0 ? (base.w * 1.1) / g.w : 1;
        mark = sx === 1 ? g : {
          w: g.w * sx,
          h: g.h,
          d: g.d,
          draw: (x, y) => `<g transform="translate(${r(x)} ${r(y)}) scale(${r(sx)} 1)">${g.draw(0, 0)}</g>`,
        };
      }
      if (node.below) {
        return {
          w: Math.max(base.w, mark.w),
          h: base.h,
          d: base.d + gap + mark.h + mark.d,
          draw: (x, y) => base.draw(x + (Math.max(base.w, mark.w) - base.w) / 2, y) +
            mark.draw(x + (Math.max(base.w, mark.w) - mark.w) / 2, y + base.d + gap + mark.h),
        };
      }
      return {
        w: Math.max(base.w, mark.w),
        h: base.h + gap + mark.h,
        d: base.d,
        draw: (x, y) => base.draw(x + (Math.max(base.w, mark.w) - base.w) / 2, y) +
          mark.draw(x + (Math.max(base.w, mark.w) - mark.w) / 2, y - base.h - gap),
      };
    }

    case 'lim': {
      const base = layoutList(node.base, ctx);
      const lim = layoutList(node.limit, sub(ctx, SCRIPT));
      return node.below ? vbox([base, lim], ctx.size * 0.08, 0) : vbox([lim, base], ctx.size * 0.08, 1);
    }

    case 'stack': {
      const rows = node.rows.map((row) => layoutList(row, ctx));
      // 多行公式以中间行为基线，整体在行内居中
      return vbox(rows, ctx.size * 0.3, Math.floor((rows.length - 1) / 2));
    }
  }
}

export interface MathLayout {
  w: number;
  h: number;
  d: number;
  /** 以 (0,0) 为基线原点的 SVG 片段 */
  svg: string;
}

/** 排版一棵公式树；size 为基准字号（px） */
export function layoutMath(nodes: MathNode[], size: number, color: string, measure: MeasureFn): MathLayout {
  const box = layoutList(nodes, { size, measure, color });
  return { w: box.w, h: box.h, d: box.d, svg: box.draw(0, 0) };
}
