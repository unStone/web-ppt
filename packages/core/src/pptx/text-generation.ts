import type { TextRun } from '../types';
import { attr, boolAttr, kid, kids, numAttr } from '../xml';
import { childColor } from './color';
import type { ColorCtx } from './color';
import { parseEffects } from './effects';

/** 只保留能原生重建的范围；预览近似不能成为无来源保存时的数据真值。 */
export function textGenerationProperties(rPr: Element | null, ctx: ColorCtx): Partial<TextRun> {
  if (!rPr) return {};
  const result: Partial<TextRun> = {}, issues: string[] = [];
  const grad = kid(rPr, 'gradFill');
  if (grad) {
    if (attr(grad, 'rotWithShape') === '0' || attr(grad, 'rotWithShape') === 'false'
      || attr(grad, 'flip') !== null) issues.push('文字渐变旋转/翻转');
    const lin = kid(grad, 'lin');
    if (!lin || kid(grad, 'path') || kid(grad, 'tileRect')) issues.push('文字渐变路径/平铺范围');
    else result.gradientFill = {
      angle: (numAttr(lin, 'ang') ?? 0) / 60000,
      scaled: boolAttr(lin, 'scaled') ?? false,
      stops: kids(kid(grad, 'gsLst'), 'gs').map(gs => ({
        pos: (numAttr(gs, 'pos') ?? 0) / 100000, color: childColor(gs, ctx) ?? '#000000',
      })).sort((a, b) => a.pos - b.pos),
    };
  } else if (['solidFill', 'noFill', 'blipFill', 'pattFill', 'grpFill'].some(name => kid(rPr, name))) {
    result.gradientFill = null;
  }
  for (const name of ['blipFill', 'pattFill', 'grpFill', 'effectDag', 'uLn', 'uLnTx']) {
    if (kid(rPr, name)) issues.push(`文字 ${name}`);
  }
  const line = kid(rPr, 'ln');
  if (line) {
    for (const child of Array.from(line.children)) {
      if (!['solidFill', 'noFill'].includes(child.localName)) issues.push(`文字描边 ${child.localName}`);
    }
    for (const name of ['cap', 'cmpd', 'algn']) {
      if (attr(line, name) !== null) issues.push(`文字描边 ${name}`);
    }
  }
  const underline = kid(rPr, 'uFill');
  if (underline && !kid(underline, 'solidFill')) issues.push('下划线非纯色填充');
  const list = kid(rPr, 'effectLst');
  if (list) {
    const shadow = parseEffects(list, ctx)?.shadow;
    result.shadowEffect = shadow ?? null;
    result.shadow = shadow ? `${shadow.dx}px ${shadow.dy}px ${shadow.blur}px ${shadow.color}` : null;
    if (list.children.length > 1) issues.push('多重文字效果');
    for (const child of Array.from(list.children)) {
      if (child.localName !== 'outerShdw') issues.push(`文字效果 ${child.localName}`);
      for (const [name, defaultValue] of [['sx', '100000'], ['sy', '100000'], ['kx', '0'], ['ky', '0'], ['algn', 'b'], ['rotWithShape', '1']]) {
        const value = attr(child, name);
        if (value !== null && value !== defaultValue) issues.push(`文字阴影 ${name}`);
      }
    }
  }
  if (issues.length) result.generationIssues = issues;
  return result;
}

const MATH_CONTAINERS = new Set([
  'oMathPara', 'oMath', 'r', 't', 'f', 'num', 'den', 'rad', 'deg', 'e',
  'sSup', 'sSub', 'sSubSup', 'sup', 'sub', 'nary', 'd', 'm', 'mr', 'acc',
  'bar', 'groupChr', 'limLow', 'limUpp', 'lim', 'eqArr',
  'rPr', 'fPr', 'radPr', 'naryPr', 'dPr', 'mPr', 'accPr', 'barPr',
  'groupChrPr', 'limLowPr', 'limUppPr', 'eqArrPr', 'sSupPr', 'sSubPr', 'sSubSupPr',
  'sty', 'type', 'degHide', 'chr', 'limLoc', 'subHide', 'supHide', 'begChr', 'endChr', 'sepChr', 'pos',
]);
const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const MATH_VALUES = new Set(['sty', 'type', 'degHide', 'chr', 'limLoc', 'subHide', 'supHide', 'begChr', 'endChr', 'sepChr', 'pos']);

export function mathGenerationIssues(root: Element): string[] {
  const issues = new Set<string>();
  const visit = (node: Element, depth: number): void => {
    if (depth > 16) { issues.add('公式超出解析深度'); return; }
    if (node.namespaceURI !== MATH_NS || !MATH_CONTAINERS.has(node.localName)) issues.add(`公式 ${node.tagName}`);
    for (const attribute of Array.from(node.attributes)) {
      const namespace = attribute.namespaceURI;
      if (namespace === 'http://www.w3.org/2000/xmlns/') continue;
      if (node.localName === 't' && attribute.name === 'xml:space') continue;
      if (MATH_VALUES.has(node.localName) && attribute.localName === 'val' && (!namespace || namespace === MATH_NS)) continue;
      issues.add(`公式属性 ${node.tagName}@${attribute.name}`);
    }
    const hiddenArguments = node.localName === 'rad' ? [['radPr', 'degHide', 'deg']]
      : node.localName === 'nary' ? [['naryPr', 'subHide', 'sub'], ['naryPr', 'supHide', 'sup']] : [];
    for (const [properties, flag, argument] of hiddenArguments) {
      const hidden = kid(kid(node, properties), flag);
      // 展示树会丢弃隐藏参数；即使不显示，原生编辑仍可能重新启用它。
      if (hidden && !['0', 'false', 'off'].includes(attr(hidden, 'val') ?? '') && kid(node, argument)?.children.length) {
        issues.add(`公式隐藏参数 ${argument}`);
      }
    }
    for (const child of Array.from(node.children)) visit(child, depth + 1);
  };
  visit(root, 0);
  return [...issues];
}
