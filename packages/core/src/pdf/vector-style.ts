import type {LiteElement} from '../xml-lite';

/** 引擎生成内联声明；分号可能属于带引号的字体名，不能直接 split。 */
export function svgStyle(el:LiteElement):Map<string,string> {
  const value = el.getAttribute('style') ?? '', parts:string[] = [];
  let start = 0, quote = '', depth = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '\\') {i++; continue;}
    if (quote) {if (c === quote) quote = ''; continue;}
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ';' && !depth) {parts.push(value.slice(start,i)); start = i + 1;}
  }
  if (quote || depth) throw new Error('PDF SVG 内联样式无效');
  parts.push(value.slice(start));
  const result = new Map<string,string>();
  for (const part of parts) {
    if (!part.trim()) continue;
    const at = part.indexOf(':'); if (at <= 0) throw new Error('PDF SVG 内联样式无效');
    result.set(part.slice(0,at).trim().toLowerCase(),part.slice(at + 1).trim());
  }
  return result;
}

export function svgLength(value:string):number {
  return /^[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?(?:px)?$/i.test(value) ? Number(value.replace(/px$/i,'')) : NaN;
}
