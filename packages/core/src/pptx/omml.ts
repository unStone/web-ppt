/**
 * OMML（Office MathML）→ 统一公式树。
 *
 * 只做结构解析，不排版：排版要测文本宽度，那是渲染层的事。
 * 未识别的元素一律「取出其中的 m:t 文本」降级，保证公式不会整块消失。
 */

import type { MathNode } from '../types';
import { attr, kid, kids } from '../xml';

/** m:xxxPr 里形如 <m:val m:val="bar"/> 的属性读法 */
function pv(parent: Element | null, name: string): string | null {
  const el = kid(parent, name);
  return el ? attr(el, 'val') : null;
}

function textOf(el: Element | null): string {
  if (!el) return '';
  let out = '';
  for (const t of kids(el, 't')) out += t.textContent ?? '';
  return out;
}

/** 容器里所有 m:t 的拼接，用于未识别元素的降级 */
function deepText(el: Element, depth = 12): string {
  let out = '';
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === 't') out += c.textContent ?? '';
    else if (depth > 0) out += deepText(c, depth - 1);
  }
  return out;
}

/** 解析一个「参数」容器（m:e / m:num / m:den / m:sup / m:sub …） */
function arg(parent: Element | null, name: string, depth: number): MathNode[] {
  const el = kid(parent, name);
  return el ? parseNodes(el, depth) : [];
}

function parseNodes(el: Element, depth: number): MathNode[] {
  const out: MathNode[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    const n = parseNode(c, depth);
    if (n) out.push(...n);
  }
  return out;
}

function parseNode(el: Element, depth: number): MathNode[] | null {
  if (depth <= 0) {
    const t = deepText(el);
    return t ? [{ kind: 'run', text: t }] : null;
  }
  const d = depth - 1;

  switch (el.localName) {
    case 'r': {
      const text = textOf(el);
      if (!text) return null;
      const sty = pv(kid(el, 'rPr'), 'sty');
      return [{ kind: 'run', text, sty: sty === 'p' || sty === 'b' || sty === 'bi' ? sty : 'i' }];
    }

    case 'f': {
      const type = pv(kid(el, 'fPr'), 'type');
      return [{
        kind: 'frac',
        num: arg(el, 'num', d),
        den: arg(el, 'den', d),
        type: type === 'noBar' || type === 'skw' || type === 'lin' ? type : 'bar',
      }];
    }

    case 'rad': {
      // degHide 为真时是平方根，此时 m:deg 里常有残留内容，必须忽略
      const hide = pv(kid(el, 'radPr'), 'degHide');
      return [{
        kind: 'rad',
        deg: hide === '1' || hide === 'on' || hide === 'true' ? [] : arg(el, 'deg', d),
        base: arg(el, 'e', d),
      }];
    }

    case 'sSup':
      return [{ kind: 'script', base: arg(el, 'e', d), sup: arg(el, 'sup', d) }];
    case 'sSub':
      return [{ kind: 'script', base: arg(el, 'e', d), sub: arg(el, 'sub', d) }];
    case 'sSubSup':
      return [{ kind: 'script', base: arg(el, 'e', d), sub: arg(el, 'sub', d), sup: arg(el, 'sup', d) }];
    case 'sPre': {
      // 前置上下标：把脚标挂在空底上，再接真正的底
      const pre: MathNode = { kind: 'script', base: [], sub: arg(el, 'sub', d), sup: arg(el, 'sup', d) };
      return [pre, ...arg(el, 'e', d)];
    }

    case 'nary': {
      const pr = kid(el, 'naryPr');
      const loc = pv(pr, 'limLoc');
      const chr = pv(pr, 'chr') ?? '∫';
      const hideSub = pv(pr, 'subHide') === '1';
      const hideSup = pv(pr, 'supHide') === '1';
      return [{
        kind: 'nary',
        chr,
        sub: hideSub ? [] : arg(el, 'sub', d),
        sup: hideSup ? [] : arg(el, 'sup', d),
        base: arg(el, 'e', d),
        // 求和 / 连乘默认上下限在正上下，积分默认在右侧
        underOver: loc ? loc === 'undOvr' : chr !== '∫' && chr !== '∮' && chr !== '∬' && chr !== '∭',
      }];
    }

    case 'd': {
      const pr = kid(el, 'dPr');
      const items = kids(el, 'e').map((e) => parseNodes(e, d));
      return [{
        kind: 'delim',
        beg: pv(pr, 'begChr') ?? '(',
        end: pv(pr, 'endChr') ?? ')',
        sep: pv(pr, 'sepChr') ?? ',',
        items: items.length ? items : [[]],
      }];
    }

    case 'm':
      return [{
        kind: 'matrix',
        rows: kids(el, 'mr').map((row) => kids(row, 'e').map((e) => parseNodes(e, d))),
      }];

    case 'acc':
      return [{ kind: 'acc', chr: pv(kid(el, 'accPr'), 'chr') ?? '̂', base: arg(el, 'e', d) }];
    case 'bar': {
      const pos = pv(kid(el, 'barPr'), 'pos');
      return [{ kind: 'acc', chr: '̅', base: arg(el, 'e', d), below: pos === 'bot' }];
    }
    case 'groupChr': {
      const pr = kid(el, 'groupChrPr');
      const pos = pv(pr, 'pos');
      return [{ kind: 'acc', chr: pv(pr, 'chr') ?? '⏟', base: arg(el, 'e', d), below: pos !== 'top' }];
    }

    case 'limLow':
      return [{ kind: 'lim', base: arg(el, 'e', d), limit: arg(el, 'lim', d), below: true }];
    case 'limUpp':
      return [{ kind: 'lim', base: arg(el, 'e', d), limit: arg(el, 'lim', d), below: false }];

    case 'func':
      // 函数名与自变量之间只是并排，不需要专门的节点类型
      return [...arg(el, 'fName', d), { kind: 'run', text: ' ' }, ...arg(el, 'e', d)];

    case 'eqArr':
      return [{ kind: 'stack', rows: kids(el, 'e').map((e) => parseNodes(e, d)) }];

    // 只是包一层的容器，直接展开
    case 'box':
    case 'borderBox':
    case 'e':
    case 'oMath':
      return parseNodes(el, d);

    // 幻影：占位不显示，用等宽空白替代
    case 'phant':
      return [{ kind: 'run', text: ' '.repeat(Math.max(1, deepText(el).length)), sty: 'p' }];

    // 属性节点与批注不产出内容
    case 'rPr': case 'ctrlPr': case 'argPr': case 'fPr': case 'radPr':
    case 'naryPr': case 'dPr': case 'mPr': case 'accPr': case 'barPr':
    case 'groupChrPr': case 'limLowPr': case 'limUppPr': case 'funcPr':
    case 'eqArrPr': case 'boxPr': case 'phantPr': case 'sSupPr':
    case 'sSubPr': case 'sSubSupPr': case 'sPrePr':
      return null;

    default: {
      // 认不出的元素：先试着往下走，走不出内容再退化成纯文本
      const inner = parseNodes(el, d);
      if (inner.length) return inner;
      const t = deepText(el);
      return t ? [{ kind: 'run', text: t }] : null;
    }
  }
}

/** 解析 m:oMath / m:oMathPara 子树 */
export function parseOmml(el: Element): MathNode[] {
  if (el.localName === 'oMathPara') {
    const parts = kids(el, 'oMath').map((m) => parseNodes(m, 16));
    // 多个 oMath 是并列的多行公式
    if (parts.length > 1) return [{ kind: 'stack', rows: parts }];
    return parts[0] ?? [];
  }
  return parseNodes(el, 16);
}

/** 公式的线性文本，用于搜索与纯文本导出 */
export function mathPlainText(nodes: MathNode[]): string {
  let out = '';
  for (const n of nodes) {
    switch (n.kind) {
      case 'run': out += n.text; break;
      case 'frac': out += `${mathPlainText(n.num)}/${mathPlainText(n.den)}`; break;
      case 'rad': out += `√(${mathPlainText(n.base)})`; break;
      case 'script':
        out += mathPlainText(n.base);
        if (n.sub?.length) out += `_${mathPlainText(n.sub)}`;
        if (n.sup?.length) out += `^${mathPlainText(n.sup)}`;
        break;
      case 'nary':
        out += n.chr;
        if (n.sub.length) out += `_${mathPlainText(n.sub)}`;
        if (n.sup.length) out += `^${mathPlainText(n.sup)}`;
        out += mathPlainText(n.base);
        break;
      case 'delim':
        out += n.beg + n.items.map((i) => mathPlainText(i)).join(n.sep) + n.end;
        break;
      case 'matrix':
        out += n.rows.map((r) => r.map((c) => mathPlainText(c)).join(' ')).join('; ');
        break;
      case 'acc': out += mathPlainText(n.base) + n.chr; break;
      case 'lim': out += `${mathPlainText(n.base)}(${mathPlainText(n.limit)})`; break;
      case 'stack': out += n.rows.map((r) => mathPlainText(r)).join(' '); break;
    }
  }
  return out;
}
