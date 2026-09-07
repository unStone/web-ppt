import type { MathNode } from '@web-ppt/core';

const esc = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const prop = (name: string, value: string): string => `<m:${name} m:val="${esc(value)}"/>`;

/** 公式树保持原子身份；不能用其线性搜索文本代替原生 OMML。 */
export function mathMarkup(nodes: readonly MathNode[], depth = 0): string {
  if (depth > 14) throw new Error('公式嵌套超出可往返深度');
  const arg = (name: string, children: readonly MathNode[]): string =>
    `<m:${name}>${mathMarkup(children, depth + 1)}</m:${name}>`;
  return nodes.map(node => {
    switch (node.kind) {
      case 'run':
        if (node.sty && !['p', 'i', 'b', 'bi'].includes(node.sty)) throw new Error('公式字形样式无效');
        return `<m:r><m:rPr>${prop('sty', node.sty ?? 'i')}</m:rPr><m:t xml:space="preserve">${esc(node.text)}</m:t></m:r>`;
      case 'frac':
        if (node.type && !['bar', 'noBar', 'skw', 'lin'].includes(node.type)) throw new Error('分式类型无效');
        return `<m:f><m:fPr>${prop('type', node.type ?? 'bar')}</m:fPr>${arg('num', node.num)}${arg('den', node.den)}</m:f>`;
      case 'rad':
        return `<m:rad><m:radPr>${prop('degHide', node.deg.length ? '0' : '1')}</m:radPr>${arg('deg', node.deg)}${arg('e', node.base)}</m:rad>`;
      case 'script': {
        if (node.sub === undefined && node.sup === undefined) throw new Error('公式脚标缺少上标或下标');
        const tag = node.sub !== undefined && node.sup !== undefined ? 'sSubSup' : node.sub !== undefined ? 'sSub' : 'sSup';
        return `<m:${tag}>${arg('e', node.base)}${node.sub !== undefined ? arg('sub', node.sub) : ''}${node.sup !== undefined ? arg('sup', node.sup) : ''}</m:${tag}>`;
      }
      case 'nary':
        return `<m:nary><m:naryPr>${prop('chr', node.chr)}${prop('limLoc', node.underOver ? 'undOvr' : 'subSup')}${prop('subHide', node.sub.length ? '0' : '1')}${prop('supHide', node.sup.length ? '0' : '1')}</m:naryPr>${arg('sub', node.sub)}${arg('sup', node.sup)}${arg('e', node.base)}</m:nary>`;
      case 'delim':
        return `<m:d><m:dPr>${prop('begChr', node.beg)}${prop('endChr', node.end)}${prop('sepChr', node.sep)}</m:dPr>${node.items.map(item => arg('e', item)).join('')}</m:d>`;
      case 'matrix':
        if (!node.rows.length || !node.rows[0].length || node.rows.some(row => row.length !== node.rows[0].length)) throw new Error('公式矩阵必须为非空矩形');
        return `<m:m>${node.rows.map(row => `<m:mr>${row.map(cell => arg('e', cell)).join('')}</m:mr>`).join('')}</m:m>`;
      case 'acc': {
        const bar = node.chr === '̅';
        const tag = bar ? 'bar' : node.below !== undefined ? 'groupChr' : 'acc';
        return `<m:${tag}><m:${tag}Pr>${!bar ? prop('chr', node.chr) : ''}${tag !== 'acc' ? prop('pos', node.below ? 'bot' : 'top') : ''}</m:${tag}Pr>${arg('e', node.base)}</m:${tag}>`;
      }
      case 'lim': {
        const tag = node.below ? 'limLow' : 'limUpp';
        return `<m:${tag}>${arg('e', node.base)}${arg('lim', node.limit)}</m:${tag}>`;
      }
      case 'stack': return `<m:eqArr>${node.rows.map(row => arg('e', row)).join('')}</m:eqArr>`;
      default: throw new Error(`不支持的公式节点：${String((node as MathNode).kind)}`);
    }
  }).join('');
}
