import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { parseXmlTree, xmlElementChildren } from '../../packages/edit-core/dist/xml.js';
import { relationships } from './chartex-probe-opc.mjs';

const SS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CX = 'http://schemas.microsoft.com/office/drawing/2014/chartex';
const attr = (node, name, ns = null) => node?.attributes.find((a) => a.localName === name && a.namespaceUri === ns)?.value;
const children = (node, name, ns = SS) => node ? xmlElementChildren(node, { localName: name, namespaceUri: ns }) : [];
const text = (node) => node?.children.map((child) => child.type === 'element' ? text(child) : child.value ?? '').join('') ?? '';
const parse = (parts, part) => parts[part] ? parseXmlTree(parts[part]).root : undefined;
const column = (label) => [...label.toUpperCase()].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0);
const colName = (index) => index ? colName(Math.floor((index - 1) / 26)) + String.fromCharCode(65 + (index - 1) % 26) : '';
const stringText = (node) => node ? xmlElementChildren(node).filter((child) => child.namespaceUri === SS)
  .map((child) => child.localName === 't' ? text(child) : child.localName === 'r' ? children(child, 't').map(text).join('') : '').join('') : '';

function cellValue(cell, address, strings) {
  const formula = children(cell, 'f')[0];
  const rawNode = children(cell, 'v')[0];
  const raw = text(rawNode), type = attr(cell, 't') ?? 'n';
  const result = (kind, value = null) => ({ address, kind, value, ...(formula ? { formula: text(formula) } : {}) });
  if (!cell) return result('missing');
  if (formula && !rawNode) return result('uncalculated');
  if (type === 'inlineStr') return children(cell, 'is').length === 1 ? result('string', stringText(children(cell, 'is')[0])) : result('invalid');
  if (type === 's') {
    const index = /^\d+$/.test(raw) ? Number(raw) : -1;
    return Number.isSafeInteger(index) && strings[index] !== undefined ? result('string', strings[index]) : result('invalid');
  }
  if (type === 'str') return rawNode ? result('string', raw) : result('invalid');
  if (type === 'e') return rawNode && raw ? result('error', raw) : result('invalid');
  if (type === 'd') return rawNode && raw ? result('date', raw) : result('invalid');
  if (type === 'b') return ['0', '1'].includes(raw) ? result('boolean', raw === '1') : result('invalid');
  if (type !== 'n') return result('invalid');
  if (!raw.trim()) return result(formula ? 'uncalculated' : 'blank');
  const number = Number(raw);
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.trim()) && Number.isFinite(number)
    ? result('number', number) : result('invalid');
}

export function chartWorkbook(parts, chartPart, chart) {
  const unavailable = (reason) => ({ source: { kind: 'unavailable', reason }, resolve: () => ({ status: 'unresolved', reason }) });
  const external = children(children(chart, 'chartData', CX)[0], 'externalData', CX);
  let source = { kind: 'host' };
  if (external.length) {
    const targets = relationships(parts, chartPart).filter((rel) => rel.id === attr(external[0], 'id', R));
    if (external.length !== 1 || targets.length !== 1) return unavailable('ambiguous-workbook');
    const target = targets[0];
    if (target.external || target.type !== `${R}/package` || !target.exists) {
      const reason = target.external ? 'external-workbook' : 'workbook-unavailable';
      return unavailable(reason);
    }
    const bytes = parts[target.resolved];
    source = { kind: 'embedded', part: target.resolved, sha256: createHash('sha256').update(bytes).digest('hex') };
    parts = unzipSync(bytes, { filter: (entry) => {
      if (entry.originalSize > 20 * 1024 * 1024) throw new Error(`工作簿 part 超过调查上限：${entry.name}`);
      return true;
    } });
  }
  const main = relationships(parts, '').filter((rel) => rel.type === `${R}/officeDocument` && !rel.external);
  const workbookPart = main.length === 1 ? main[0].resolved : '';
  const workbook = parse(parts, workbookPart);
  // officeDocument 也能指向演示文稿；缓存图表并不必然拥有可读取的工作簿。
  if (workbook?.namespaceUri !== SS || workbook.localName !== 'workbook') return unavailable('workbook-unavailable');
  return { source: { ...source, workbookPart }, resolve: workbookReferences(parts, workbookPart) };
}

/** 只读取单矩形 A1 引用，不计算公式，也不把缓存缺失自动补零。 */
function workbookReferences(parts, workbookPart) {
  const workbook = parse(parts, workbookPart);
  const names = children(children(workbook, 'definedNames')[0], 'definedName');
  const sheets = children(children(workbook, 'sheets')[0], 'sheet');
  const rels = relationships(parts, workbookPart ?? '');
  const stringPart = rels.filter((rel) => rel.type === `${R}/sharedStrings` && !rel.external);
  const strings = stringPart.length === 1 ? children(parse(parts, stringPart[0].resolved), 'si').map(stringText) : [];
  return (formula) => {
    const unresolved = (reason) => ({ status: 'unresolved', formula, reason });
    if (!workbook) return unresolved('workbook-unavailable');
    const matches = names.filter((name) => attr(name, 'name') === formula);
    if (matches.length > 1 || matches.some((name) => attr(name, 'localSheetId') !== undefined)) return unresolved('ambiguous-name');
    const reference = matches.length ? text(matches[0]) : formula;
    const match = /^(?:'((?:[^']|'')+)'|([^'!\[\]]+))!\$?([A-Z]+)\$?([1-9]\d*)(?::\$?([A-Z]+)\$?([1-9]\d*))?$/i.exec(reference);
    if (!match) return unresolved('unsupported-reference');
    const sheetName = (match[1]?.replaceAll("''", "'") ?? match[2]);
    const sheet = sheets.filter((node) => attr(node, 'name') === sheetName);
    if (sheet.length !== 1) return unresolved('missing-or-ambiguous-sheet');
    const targets = rels.filter((rel) => rel.id === attr(sheet[0], 'id', R) && rel.type === `${R}/worksheet` && !rel.external);
    if (targets.length !== 1 || !targets[0].exists) return unresolved('worksheet-unavailable');
    const c1 = column(match[3]), r1 = Number(match[4]), c2 = column(match[5] ?? match[3]), r2 = Number(match[6] ?? match[4]);
    if (c1 > c2 || r1 > r2 || c2 > 16384 || r2 > 1048576 || (c2 - c1 + 1) * (r2 - r1 + 1) > 10000) return unresolved('range-limit');
    const worksheet = parse(parts, targets[0].resolved);
    const entries = children(children(worksheet, 'sheetData')[0], 'row').flatMap((row) => children(row, 'c'));
    const cells = new Map(entries.map((cell) => [attr(cell, 'r'), cell]));
    if (cells.size !== entries.length) return unresolved('duplicate-cell');
    const rows = [];
    for (let row = r1; row <= r2; row++) {
      const values = [];
      for (let col = c1; col <= c2; col++) {
        const address = `${colName(col)}${row}`, cell = cells.get(address);
        values.push(cellValue(cell, address, strings));
      }
      rows.push(values);
    }
    return { status: 'resolved', formula, reference, sheet: sheetName, part: targets[0].resolved, rows };
  };
}
