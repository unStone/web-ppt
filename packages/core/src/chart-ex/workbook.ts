import { unzipSync } from 'fflate';
import type { ChartEnv } from '../chart/hook';
import { attr, parseXml } from '../xml';
import { child, children, integer, LIMIT, number } from './data';
import type { Value } from './data';
const SS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OPC = 'http://schemas.openxmlformats.org/package/2006/relationships';
const column = (s: string): number => [...s.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const columnName = (n: number): string => n ? columnName(Math.floor((n - 1) / 26)) + String.fromCharCode(65 + (n - 1) % 26) : '';
const stringText = (node: Element | null): string => children(node, 't', SS).map((n) => n.textContent ?? '').join('')
  + children(node, 'r', SS).map((n) => children(n, 't', SS).map((t) => t.textContent ?? '').join('')).join('');
/** 只读包内矩形与已计算值，不联网、不求值公式；缺缓存才按需解开工作簿。 */
export function workbookResolver(root: Element, env: ChartEnv): (formula: Element) => Value[][] {
  let resolve: ((formula: Element) => Value[][]) | undefined;
  return (formula) => {
    if (!resolve) {
      const external = children(child(root, 'chartData'), 'externalData');
      if (external.length !== 1)
        throw new Error('ChartEx 缺少唯一内嵌工作簿');
      const rel = env.rels[attr(external[0], 'r:id') ?? ''];
      const bytes = rel?.type === `${R}/package` ? env.readPart?.(rel.target) : undefined;
      if (!bytes)
        throw new Error('ChartEx 工作簿不可用');
      let size = 0;
      const parts = unzipSync(bytes, { filter: (file) => {
          size += file.originalSize;
          if (size > 32 * 1024 * 1024)
            throw new Error('ChartEx 工作簿超限');
          return /\.xml$|\.rels$/.test(file.name);
        } });
      resolve = references(parts);
    }
    return resolve(formula);
  };
}
function references(parts: Record<string, Uint8Array>): (formula: Element) => Value[][] {
  const cache = new Map<string, Element>();
  const xml = (path: string): Element => {
    if (!parts[path])
      throw new Error('ChartEx 工作簿 part 缺失');
    if (!cache.has(path))
      cache.set(path, parseXml(new TextDecoder().decode(parts[path])));
    return cache.get(path)!;
  };
  const relations = (part: string): {
    id: string;
    type: string;
    target: string;
  }[] => {
    const at = part.lastIndexOf('/') + 1, dir = part.slice(0, at);
    const path = `${dir}_rels/${part.slice(at)}.rels`;
    if (!parts[path])
      return [];
    return children(xml(path), 'Relationship', OPC).filter((rel) => attr(rel, 'TargetMode') !== 'External').map((rel) => {
      const target = attr(rel, 'Target') ?? '';
      if (/^[a-z]+:|[?#\\]/i.test(target))
        throw new Error('ChartEx 非包内关系');
      const segments: string[] = [];
      for (const segment of (target.startsWith('/') ? target : dir + target).split('/')) {
        if (segment === '..') {
          if (!segments.length)
            throw new Error('ChartEx 关系越界');
          segments.pop();
        }
        else if (segment && segment !== '.')
          segments.push(segment);
      }
      return { id: attr(rel, 'Id') ?? '', type: attr(rel, 'Type') ?? '', target: segments.join('/') };
    });
  };
  const unique = <T>(items: T[]): T => { if (items.length !== 1)
    throw new Error('ChartEx 工作簿绑定歧义'); return items[0]; };
  const main = unique(relations('').filter((rel) => rel.type === `${R}/officeDocument`));
  const workbook = xml(main.target);
  if (workbook.namespaceURI !== SS || workbook.localName !== 'workbook')
    throw new Error('ChartEx 非工作簿');
  const rels = relations(main.target);
  const names = children(child(workbook, 'definedNames', SS), 'definedName', SS);
  const stringsRel = rels.filter((rel) => rel.type === `${R}/sharedStrings`);
  if (stringsRel.length > 1)
    throw new Error('ChartEx 共享字符串歧义');
  const strings = stringsRel.length ? children(xml(stringsRel[0].target), 'si', SS).map(stringText) : [];
  return (formula) => {
    let ref = formula.textContent ?? '';
    const named = names.filter((name) => attr(name, 'name') === ref);
    if (named.length) {
      const name = unique(named);
      if (attr(name, 'localSheetId') !== null)
        throw new Error('ChartEx 局部名称不支持');
      ref = name.textContent ?? '';
    }
    const match = /^(?:'((?:[^']|'')+)'|([^'!\[\]]+))!\$?([A-Z]+)\$?([1-9]\d*)(?::\$?([A-Z]+)\$?([1-9]\d*))?$/i.exec(ref);
    if (!match)
      throw new Error('ChartEx 非矩形引用');
    const sheetName = match[1]?.replace(/''/g, "'") ?? match[2];
    const sheet = unique(children(child(workbook, 'sheets', SS), 'sheet', SS).filter((s) => attr(s, 'name') === sheetName));
    const target = unique(rels.filter((rel) => rel.id === attr(sheet, 'r:id') && rel.type === `${R}/worksheet`));
    const c1 = column(match[3]), r1 = Number(match[4]), c2 = column(match[5] ?? match[3]), r2 = Number(match[6] ?? match[4]);
    if (c1 > c2 || r1 > r2 || c2 > 16384 || r2 > 1048576 || (c2 - c1 + 1) * (r2 - r1 + 1) > LIMIT)
      throw new Error('ChartEx 范围超限');
    const entries = children(child(xml(target.target), 'sheetData', SS), 'row', SS).flatMap((r) => children(r, 'c', SS));
    const cells = new Map(entries.map((c) => [attr(c, 'r'), c]));
    if (cells.size !== entries.length)
      throw new Error('ChartEx 单元格重复');
    const value = (cell: Element | undefined): Value => {
      if (!cell)
        return null;
      const raw = child(cell, 'v', SS)?.textContent ?? null;
      const type = attr(cell, 't') ?? 'n';
      if (type === 'inlineStr')
        return stringText(child(cell, 'is', SS));
      if (type === 'str' && raw !== null)
        return raw;
      if (type === 's') {
        const text = strings[integer(raw, strings.length - 1)];
        if (text === undefined)
          throw new Error('ChartEx 字符串索引无效');
        return text;
      }
      if (type !== 'n')
        throw new Error('ChartEx 单元格不是文字或数值');
      if (raw === null && !child(cell, 'f', SS))
        return null;
      return number(raw);
    };
    const rows = Array.from({ length: r2 - r1 + 1 }, (_, r) => Array.from({ length: c2 - c1 + 1 }, (_, c) => value(cells.get(`${columnName(c1 + c)}${r1 + r}`))));
    const dir = attr(formula, 'dir') ?? 'col';
    if (dir !== 'col' && dir !== 'row')
      throw new Error('ChartEx 维度方向无效');
    return (dir === 'row' ? rows : rows[0].map((_, c) => rows.map((r) => r[c]))).reverse();
  };
}
