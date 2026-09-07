import { parseXmlTree, serializeXmlTreeBytes, xmlElementChildren, createXmlElement, createXmlText,
  insertXmlChildUnchecked as append, removeXmlChild, setXmlAttribute, removeXmlAttribute } from '@web-ppt/edit-core/xml';
import type { XmlElement } from '@web-ppt/edit-core/xml';
import { attr, child, children, R, relPart, resolvePart } from './container';
import type { EmbeddedPackage } from './container';

export type OleCellValue = string | number | boolean | null;
export interface OleCell { ref: string; value: OleCellValue; formula?: string }
export interface OleSheet { id: string; name: string; cells: OleCell[] }
export interface OleParagraph { index: number; text: string; editable: boolean }
export type OleContent = { kind: 'xlsx'; sheets: OleSheet[] } | { kind: 'docx'; paragraphs: OleParagraph[] };
export interface OleEdits { cells: { sheet: string; ref: string; value: OleCellValue }[]; paragraphs: { index: number; text: string }[] }
const SS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const text = (n: XmlElement | undefined): string => n?.children.map((c) => c.type === 'text' || c.type === 'cdata' ? c.value : c.type === 'element' ? text(c) : '').join('') ?? '';
const descendants = (root: XmlElement, name: string, namespace = root.namespaceUri): XmlElement[] => {
  const result: XmlElement[] = [], pending = [root];
  while (pending.length) { const n = pending.pop()!; if (n.localName === name && n.namespaceUri === namespace) result.push(n); pending.push(...xmlElementChildren(n).reverse()); }
  return result;
};
function sheets(pkg: EmbeddedPackage) {
  const main = parseXmlTree(pkg.parts[pkg.main]).root, relationships = children(parseXmlTree(pkg.parts[relPart(pkg.main)]).root, 'Relationship');
  return children(child(main, 'sheets'), 'sheet').map((sheet) => {
    const rid = sheet.attributes.find((a) => a.localName === 'id' && a.namespaceUri === R)?.value;
    const relation = relationships.find((r) => attr(r, 'Id') === rid && attr(r, 'Type') === `${R}/worksheet` && attr(r, 'TargetMode') !== 'External');
    if (!relation) return null;
    return { id: attr(sheet, 'sheetId')!, name: attr(sheet, 'name')!, part: resolvePart(pkg.main, attr(relation, 'Target')!) };
  }).filter((value) => value !== null);
}
export function cellPosition(ref: string): [number, number] {
  if (!/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(ref)) throw new Error('单元格地址无效');
  const [, letters, digits] = /^([A-Z]+)(\d+)$/.exec(ref)!;
  const column = [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0), row = Number(digits);
  if (column > 16384 || row > 1048576) throw new Error('单元格地址越界'); return [row, column];
}
function contentText(root: XmlElement) { return descendants(root, 't', SS).map(text).join(''); }
export function readOleContent(pkg: EmbeddedPackage): OleContent {
  if (pkg.kind === 'docx') {
    const main = parseXmlTree(pkg.parts[pkg.main]).root;
    return { kind: 'docx', paragraphs: descendants(main, 'p', W).map((p, index) => ({ index,
      text: descendants(p, 't', W).map(text).join(''),
      editable: !['fldChar', 'instrText', 'del', 'ins', 'sdt', 'pict', 'drawing', 'object', 'br', 'tab'].some((name) => descendants(p, name, W).length),
    })) };
  }
  const rels = children(parseXmlTree(pkg.parts[relPart(pkg.main)]).root, 'Relationship');
  const sharedRel = rels.find((n) => attr(n, 'Type') === `${R}/sharedStrings` && attr(n, 'TargetMode') !== 'External');
  const sharedPart = sharedRel && pkg.parts[resolvePart(pkg.main, attr(sharedRel, 'Target')!)];
  const shared = sharedPart ? children(parseXmlTree(sharedPart).root, 'si').map(contentText) : [];
  let total = 0;
  return { kind: 'xlsx', sheets: sheets(pkg).map(({ id, name, part }) => ({ id, name,
    cells: descendants(parseXmlTree(pkg.parts[part]).root, 'c', SS).map((c) => {
      if (++total > 100000) throw new Error('嵌入表格单元格超限');
      const ref = attr(c, 'r')!; cellPosition(ref); const type = attr(c, 't'), raw = text(child(c, 'v')), formula = child(c, 'f');
      const value = type === 'inlineStr' ? contentText(c) : type === 's' ? shared[Number(raw)] ?? '' : type === 'b' ? raw === '1'
        : type === 'str' || type === 'e' ? raw : raw === '' ? null : Number(raw);
      return { ref, value, ...(formula ? { formula: text(formula) } : {}) };
    }),
  })) };
}

export function normalizeOleEdits(value: unknown): OleEdits {
  if (!value || typeof value !== 'object') throw new Error('OLE 编辑数据无效');
  const state = value as OleEdits;
  if (!Array.isArray(state.cells) || !Array.isArray(state.paragraphs) || state.cells.length + state.paragraphs.length > 10000) throw new Error('OLE 编辑数据超限');
  const seen = new Set<string>(), validText = (v: unknown): v is string => typeof v === 'string' && v.length <= 32767 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(v);
  const cells = state.cells.map((c) => {
    if (!c || typeof c.sheet !== 'string' || !/^\d+$/.test(c.sheet) || typeof c.ref !== 'string') throw new Error('OLE 单元格无效');
    cellPosition(c.ref);
    if (!(c.value === null || typeof c.value === 'boolean' || typeof c.value === 'number' && Number.isFinite(c.value) || validText(c.value))) throw new Error('OLE 单元格值无效');
    const key = c.sheet + ':' + c.ref; if (seen.has(key)) throw new Error('OLE 单元格重复'); seen.add(key);
    return { sheet: c.sheet, ref: c.ref, value: c.value };
  }).sort((a, b) => a.sheet.localeCompare(b.sheet) || cellPosition(a.ref)[0] - cellPosition(b.ref)[0] || cellPosition(a.ref)[1] - cellPosition(b.ref)[1]);
  const paragraphs = state.paragraphs.map((p) => {
    if (!p || !Number.isInteger(p.index) || p.index < 0 || !validText(p.text)) throw new Error('OLE 段落无效');
    const key = 'p' + p.index; if (seen.has(key)) throw new Error('OLE 段落重复'); seen.add(key);
    return { index: p.index, text: p.text };
  }).sort((a, b) => a.index - b.index);
  return { cells, paragraphs };
}

export function editOleParts(pkg: EmbeddedPackage, edits: OleEdits): Record<string, Uint8Array | null> {
  const changes: Record<string, Uint8Array | null> = Object.create(null);
  const add = (parent: XmlElement, name: string, ns: string) => { const n = createXmlElement(name, { attributes: [['xmlns', ns]] }); append(parent, n); return n; };
  if (pkg.kind === 'docx') {
    if (edits.cells.length) throw new Error('文档不支持单元格编辑');
    const main = parseXmlTree(pkg.parts[pkg.main]), paragraphs = descendants(main.root, 'p', W), content = readOleContent(pkg);
    if (content.kind !== 'docx') throw new Error('OLE 文档格式错误');
    for (const edit of edits.paragraphs) {
      const p = paragraphs[edit.index]; if (!p || !content.paragraphs[edit.index].editable) throw new Error('段落含域、图形或修订，不能直接替换文字');
      const nodes = descendants(p, 't', W);
      if (!nodes.length) nodes.push(add(add(p, 'r', W), 't', W));
      nodes.forEach((node, i) => {
        for (const c of [...node.children]) removeXmlChild(node, c);
        append(node, createXmlText(i ? '' : edit.text)); setXmlAttribute(node, 'xml:space', 'preserve');
      });
    }
    if (edits.paragraphs.length) changes[pkg.main] = serializeXmlTreeBytes(main);
    return changes;
  }
  if (edits.paragraphs.length) throw new Error('表格不支持文档段落编辑');
  const list = sheets(pkg), trees = new Map<string, ReturnType<typeof parseXmlTree>>();
  for (const edit of edits.cells) {
    const sheet = list.find((s) => s.id === edit.sheet); if (!sheet) throw new Error('工作表不存在');
    const tree = trees.get(sheet.part) ?? parseXmlTree(pkg.parts[sheet.part]); trees.set(sheet.part, tree);
    if (child(tree.root, 'sheetProtection')) throw new Error('工作表受保护');
    const data = child(tree.root, 'sheetData'); if (!data) throw new Error('工作表缺少 sheetData');
    const [rowNumber, column] = cellPosition(edit.ref);
    let row = children(data, 'row').find((r) => Number(attr(r, 'r')) === rowNumber);
    if (!row) {
      row = createXmlElement('row', { attributes: [['xmlns', SS], ['r', String(rowNumber)]] });
      append(data, row, children(data, 'row').find((r) => Number(attr(r, 'r')) > rowNumber) ?? null);
    }
    let c = children(row, 'c').find((n) => attr(n, 'r') === edit.ref);
    if (c && child(c, 'f') && ['array', 'dataTable', 'shared'].includes(attr(child(c, 'f')!, 't') ?? '')) throw new Error('数组或共享公式不能单独替换');
    if (!c) { c = createXmlElement('c', { attributes: [['xmlns', SS], ['r', edit.ref]] }); append(row, c, children(row, 'c').find((n) => cellPosition(attr(n, 'r')!)[1] > column) ?? null); }
    for (const node of xmlElementChildren(c)) if (['f', 'v', 'is'].includes(node.localName)) removeXmlChild(c, node);
    removeXmlAttribute(c, 't');
    if (edit.value !== null) {
      setXmlAttribute(c, 't', typeof edit.value === 'string' ? 'inlineStr' : typeof edit.value === 'boolean' ? 'b' : 'n');
      const n = typeof edit.value === 'string' ? add(add(c, 'is', SS), 't', SS) : add(c, 'v', SS);
      append(n, createXmlText(typeof edit.value === 'boolean' ? edit.value ? '1' : '0' : String(edit.value)));
      if (typeof edit.value === 'string') setXmlAttribute(n, 'xml:space', 'preserve');
    }
    // 缓存范围和计算链都可能因新增格子失效，交由宿主按原公式完整重算。
    const dimension = child(tree.root, 'dimension'); if (dimension) removeXmlChild(tree.root, dimension);
    removeXmlAttribute(row, 'spans');
  }
  for (const [part, tree] of trees) changes[part] = serializeXmlTreeBytes(tree);
  if (edits.cells.length) {
    const main = parseXmlTree(pkg.parts[pkg.main]); let calc = child(main.root, 'calcPr');
    if (!calc) { calc = createXmlElement('calcPr', { attributes: [['xmlns', SS]] }); const order = ['oleSize', 'customWorkbookViews', 'pivotCaches', 'smartTagPr', 'smartTagTypes', 'webPublishing', 'fileRecoveryPr', 'webPublishObjects', 'extLst']; append(main.root, calc, xmlElementChildren(main.root).find((n) => order.includes(n.localName)) ?? null); }
    setXmlAttribute(calc, 'fullCalcOnLoad', '1'); setXmlAttribute(calc, 'forceFullCalc', '1'); setXmlAttribute(calc, 'calcMode', 'auto');
    changes[pkg.main] = serializeXmlTreeBytes(main);
    const rels = parseXmlTree(pkg.parts[relPart(pkg.main)]), types = parseXmlTree(pkg.parts['[Content_Types].xml']);
    for (const r of children(rels.root, 'Relationship')) if (attr(r, 'Type') === `${R}/calcChain`) {
      const part = resolvePart(pkg.main, attr(r, 'Target')!); changes[part] = null; removeXmlChild(rels.root, r);
      for (const declaration of children(types.root, 'Override')) if (attr(declaration, 'PartName') === '/' + part) removeXmlChild(types.root, declaration);
    }
    changes[relPart(pkg.main)] = serializeXmlTreeBytes(rels); changes['[Content_Types].xml'] = serializeXmlTreeBytes(types);
  }
  return changes;
}
