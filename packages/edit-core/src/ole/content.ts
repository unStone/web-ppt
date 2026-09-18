import { parseXmlTree, serializeXmlTreeBytes, xmlElementChildren, createXmlElement, createXmlText,
  insertXmlChildUnchecked as append, removeXmlChild, setXmlAttribute, removeXmlAttribute } from '@web-ppt/edit-core/xml';
import type { XmlElement } from '@web-ppt/edit-core/xml';
import { attr, child, children, R, relPart, resolvePart } from './container';
import type { EmbeddedPackage } from './container';

export type OleCellValue = string | number | boolean | null;
export interface OleRunFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** 半磅，来自 w:sz/@w:val */
  size?: number;
  /** 六位十六进制，来自 w:color/@w:val */
  color?: string;
}
export interface OleRun { index: number; text: string; format: OleRunFormat }
export interface OleParagraph {
  index: number;
  text: string;
  editable: boolean;
  runs: OleRun[];
  /** 位于 w:tbl → w:tc 内时记录行列（0-based） */
  table?: { row: number; col: number };
}
export interface OleCellStyle {
  font?: { name?: string; size?: number; bold?: boolean; italic?: boolean; color?: string };
  fill?: { color?: string };
  border?: { color?: string; style?: string };
}
export interface OleRichRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  size?: number;
  color?: string;
}
export interface OleCell {
  ref: string;
  value: OleCellValue;
  formula?: string;
  styleIndex?: number;
  style?: OleCellStyle;
  richText?: OleRichRun[];
}
export interface OleSheet { id: string; name: string; cells: OleCell[] }
export type OleContent = { kind: 'xlsx'; sheets: OleSheet[] } | { kind: 'docx'; paragraphs: OleParagraph[] };
export interface OleEdits {
  cells: {
    sheet: string;
    ref: string;
    value?: OleCellValue;
    /** null 表示清除样式索引 */
    style?: OleCellStyle | null;
    /** null 表示改回普通字符串值 */
    richText?: OleRichRun[] | null;
  }[];
  paragraphs: { index: number; text?: string; runs?: { index: number; text: string }[] }[];
}
const SS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const text = (n: XmlElement | undefined): string => n?.children.map((c) => c.type === 'text' || c.type === 'cdata' ? c.value : c.type === 'element' ? text(c) : '').join('') ?? '';
const descendants = (root: XmlElement, name: string, namespace = root.namespaceUri): XmlElement[] => {
  const result: XmlElement[] = [], pending = [root];
  while (pending.length) { const n = pending.pop()!; if (n.localName === name && n.namespaceUri === namespace) result.push(n); pending.push(...xmlElementChildren(n).reverse()); }
  return result;
};
const val = (el: XmlElement | undefined, name = 'val'): string | undefined => el ? attr(el, name) ?? undefined : undefined;
const hasOn = (pr: XmlElement | undefined, name: string): boolean | undefined => {
  const n = child(pr, name); if (!n) return undefined;
  const v = attr(n, 'val'); return v === undefined || v === 'true' || v === '1' || v === 'on';
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
const FORBIDDEN_P = ['fldChar', 'instrText', 'del', 'ins', 'sdt', 'pict', 'drawing', 'object', 'br', 'tab'] as const;

function readRunFormat(rPr: XmlElement | undefined): OleRunFormat {
  if (!rPr) return {};
  const format: OleRunFormat = {};
  if (hasOn(rPr, 'b')) format.bold = true;
  if (hasOn(rPr, 'i')) format.italic = true;
  if (child(rPr, 'u')) format.underline = true;
  const sz = val(child(rPr, 'sz')); if (sz && Number.isFinite(Number(sz))) format.size = Number(sz);
  const color = val(child(rPr, 'color')); if (color && /^[0-9A-Fa-f]{6}$/.test(color)) format.color = color.toUpperCase();
  return format;
}

function paragraphEditable(p: XmlElement): boolean {
  return !FORBIDDEN_P.some((name) => descendants(p, name, W).length);
}

/** 自 body 向下扫表格，建立段落 → 单元格坐标；XML 树不公开 parent。 */
function tableCoords(body: XmlElement): Map<XmlElement, { row: number; col: number }> {
  const map = new Map<XmlElement, { row: number; col: number }>();
  for (const tbl of descendants(body, 'tbl', W)) {
    children(tbl, 'tr').forEach((tr, row) => {
      children(tr, 'tc').forEach((tc, col) => {
        for (const p of descendants(tc, 'p', W)) map.set(p, { row, col });
      });
    });
  }
  return map;
}

function readDocxRuns(p: XmlElement): OleRun[] {
  return children(p, 'r').map((r, index) => ({
    index,
    text: descendants(r, 't', W).map(text).join(''),
    format: readRunFormat(child(r, 'rPr')),
  }));
}

function readSharedItem(si: XmlElement): { text: string; richText?: OleRichRun[] } {
  const runs = children(si, 'r');
  if (!runs.length) return { text: contentText(si) };
  const richText = runs.map((r) => {
    const rPr = child(r, 'rPr');
    const item: OleRichRun = { text: text(child(r, 't')) };
    if (hasOn(rPr, 'b')) item.bold = true;
    if (hasOn(rPr, 'i')) item.italic = true;
    if (child(rPr, 'u')) item.underline = true;
    const sz = val(child(rPr, 'sz')); if (sz && Number.isFinite(Number(sz))) item.size = Number(sz);
    const color = val(child(rPr, 'color'), 'rgb') ?? val(child(rPr, 'color'));
    if (color && /^[0-9A-Fa-f]{6}$/.test(color)) item.color = color.toUpperCase();
    return item;
  });
  return { text: richText.map((r) => r.text).join(''), richText: richText.length > 1 || richText.some((r) => r.bold || r.italic || r.underline || r.size || r.color) ? richText : undefined };
}

interface StyleTables {
  fonts: OleCellStyle['font'][];
  fills: OleCellStyle['fill'][];
  borders: OleCellStyle['border'][];
  xfs: { fontId: number; fillId: number; borderId: number }[];
}

function readStyleTables(bytes: Uint8Array | undefined): StyleTables | null {
  if (!bytes) return null;
  const root = parseXmlTree(bytes).root;
  const fonts = children(child(root, 'fonts'), 'font').map((font) => {
    const out: NonNullable<OleCellStyle['font']> = {};
    const name = val(child(font, 'name')); if (name) out.name = name;
    const sz = val(child(font, 'sz')); if (sz && Number.isFinite(Number(sz))) out.size = Number(sz);
    if (child(font, 'b')) out.bold = true;
    if (child(font, 'i')) out.italic = true;
    const color = val(child(font, 'color'), 'rgb') ?? val(child(font, 'color'));
    if (color && /^[0-9A-Fa-f]{6}$/.test(color)) out.color = color.toUpperCase();
    return out;
  });
  const fills = children(child(root, 'fills'), 'fill').map((fill) => {
    const pattern = child(fill, 'patternFill');
    const fg = child(pattern, 'fgColor');
    const color = val(fg, 'rgb') ?? val(fg);
    return color && /^[0-9A-Fa-f]{6,8}$/.test(color) ? { color: color.slice(-6).toUpperCase() } : {};
  });
  const borders = children(child(root, 'borders'), 'border').map((border) => {
    const side = child(border, 'left') ?? child(border, 'right') ?? child(border, 'top') ?? child(border, 'bottom');
    if (!side) return {};
    const style = attr(side, 'style') ?? undefined;
    const color = val(child(side, 'color'), 'rgb') ?? val(child(side, 'color'));
    const out: NonNullable<OleCellStyle['border']> = {};
    if (style) out.style = style;
    if (color && /^[0-9A-Fa-f]{6,8}$/.test(color)) out.color = color.slice(-6).toUpperCase();
    return out;
  });
  const xfs = children(child(root, 'cellXfs'), 'xf').map((xf) => ({
    fontId: Number(attr(xf, 'fontId') ?? 0),
    fillId: Number(attr(xf, 'fillId') ?? 0),
    borderId: Number(attr(xf, 'borderId') ?? 0),
  }));
  return { fonts, fills, borders, xfs };
}

function resolveStyle(tables: StyleTables | null, index: number | undefined): OleCellStyle | undefined {
  if (!tables || index === undefined || !Number.isInteger(index) || index < 0 || index >= tables.xfs.length) return undefined;
  const xf = tables.xfs[index]!;
  const style: OleCellStyle = {};
  const font = tables.fonts[xf.fontId]; if (font && Object.keys(font).length) style.font = { ...font };
  const fill = tables.fills[xf.fillId]; if (fill && Object.keys(fill).length) style.fill = { ...fill };
  const border = tables.borders[xf.borderId]; if (border && Object.keys(border).length) style.border = { ...border };
  return Object.keys(style).length ? style : undefined;
}

export function readOleContent(pkg: EmbeddedPackage): OleContent {
  if (pkg.kind === 'docx') {
    const main = parseXmlTree(pkg.parts[pkg.main]).root;
    const body = child(main, 'body') ?? main;
    const inTable = tableCoords(body);
    return { kind: 'docx', paragraphs: descendants(main, 'p', W).map((p, index) => {
      const runs = readDocxRuns(p);
      const table = inTable.get(p);
      return {
        index,
        text: runs.map((r) => r.text).join('') || descendants(p, 't', W).map(text).join(''),
        editable: paragraphEditable(p),
        runs,
        ...(table ? { table } : {}),
      };
    }) };
  }
  const rels = children(parseXmlTree(pkg.parts[relPart(pkg.main)]).root, 'Relationship');
  const sharedRel = rels.find((n) => attr(n, 'Type') === `${R}/sharedStrings` && attr(n, 'TargetMode') !== 'External');
  const sharedPart = sharedRel && resolvePart(pkg.main, attr(sharedRel, 'Target')!);
  const sharedBytes = sharedPart ? pkg.parts[sharedPart] : undefined;
  const sharedItems = sharedBytes ? children(parseXmlTree(sharedBytes).root, 'si').map(readSharedItem) : [];
  const stylesRel = rels.find((n) => attr(n, 'Type') === `${R}/styles` && attr(n, 'TargetMode') !== 'External');
  const stylesPart = stylesRel && resolvePart(pkg.main, attr(stylesRel, 'Target')!);
  const styles = readStyleTables(stylesPart ? pkg.parts[stylesPart] : undefined);
  let total = 0;
  return { kind: 'xlsx', sheets: sheets(pkg).map(({ id, name, part }) => ({ id, name,
    cells: descendants(parseXmlTree(pkg.parts[part]).root, 'c', SS).map((c) => {
      if (++total > 100000) throw new Error('嵌入表格单元格超限');
      const ref = attr(c, 'r')!; cellPosition(ref); const type = attr(c, 't'), raw = text(child(c, 'v')), formula = child(c, 'f');
      const styleIndex = attr(c, 's') !== undefined ? Number(attr(c, 's')) : undefined;
      let value: OleCellValue;
      let richText: OleRichRun[] | undefined;
      if (type === 'inlineStr') value = contentText(c);
      else if (type === 's') {
        const item = sharedItems[Number(raw)];
        value = item?.text ?? '';
        richText = item?.richText;
      } else if (type === 'b') value = raw === '1';
      else if (type === 'str' || type === 'e') value = raw;
      else value = raw === '' ? null : Number(raw);
      const style = resolveStyle(styles, styleIndex);
      return {
        ref, value,
        ...(formula ? { formula: text(formula) } : {}),
        ...(styleIndex !== undefined && Number.isFinite(styleIndex) ? { styleIndex } : {}),
        ...(style ? { style } : {}),
        ...(richText ? { richText } : {}),
      };
    }),
  })) };
}

const validText = (v: unknown): v is string => typeof v === 'string' && v.length <= 32767 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(v);
const validRich = (runs: unknown): runs is OleRichRun[] => Array.isArray(runs) && runs.length > 0 && runs.length <= 100
  && runs.every((r) => r && validText(r.text) && (r.bold === undefined || typeof r.bold === 'boolean')
    && (r.italic === undefined || typeof r.italic === 'boolean') && (r.underline === undefined || typeof r.underline === 'boolean')
    && (r.size === undefined || typeof r.size === 'number' && Number.isFinite(r.size))
    && (r.color === undefined || typeof r.color === 'string' && /^[0-9A-Fa-f]{6}$/.test(r.color)));
const validStyle = (style: unknown): style is OleCellStyle => {
  if (!style || typeof style !== 'object') return false;
  const s = style as OleCellStyle;
  const fontOk = !s.font || typeof s.font === 'object' && (s.font.name === undefined || typeof s.font.name === 'string')
    && (s.font.size === undefined || typeof s.font.size === 'number') && (s.font.bold === undefined || typeof s.font.bold === 'boolean')
    && (s.font.italic === undefined || typeof s.font.italic === 'boolean')
    && (s.font.color === undefined || typeof s.font.color === 'string' && /^[0-9A-Fa-f]{6}$/.test(s.font.color));
  const fillOk = !s.fill || typeof s.fill === 'object' && (s.fill.color === undefined || typeof s.fill.color === 'string' && /^[0-9A-Fa-f]{6}$/.test(s.fill.color));
  const borderOk = !s.border || typeof s.border === 'object'
    && (s.border.color === undefined || typeof s.border.color === 'string' && /^[0-9A-Fa-f]{6}$/.test(s.border.color))
    && (s.border.style === undefined || typeof s.border.style === 'string');
  return !!(fontOk && fillOk && borderOk && (s.font || s.fill || s.border));
};

export function normalizeOleEdits(value: unknown): OleEdits {
  if (!value || typeof value !== 'object') throw new Error('OLE 编辑数据无效');
  const state = value as OleEdits;
  if (!Array.isArray(state.cells) || !Array.isArray(state.paragraphs) || state.cells.length + state.paragraphs.length > 10000) throw new Error('OLE 编辑数据超限');
  const seen = new Set<string>();
  const cells = state.cells.map((c) => {
    if (!c || typeof c.sheet !== 'string' || !/^\d+$/.test(c.sheet) || typeof c.ref !== 'string') throw new Error('OLE 单元格无效');
    cellPosition(c.ref);
    const hasValue = 'value' in c, hasStyle = 'style' in c, hasRich = 'richText' in c;
    if (!hasValue && !hasStyle && !hasRich) throw new Error('OLE 单元格缺少变更');
    if (hasValue && !(c.value === null || typeof c.value === 'boolean' || typeof c.value === 'number' && Number.isFinite(c.value) || validText(c.value))) throw new Error('OLE 单元格值无效');
    if (hasStyle && c.style !== null && !validStyle(c.style)) throw new Error('OLE 单元格样式无效');
    if (hasRich && c.richText !== null && !validRich(c.richText)) throw new Error('OLE 富文本无效');
    const key = c.sheet + ':' + c.ref; if (seen.has(key)) throw new Error('OLE 单元格重复'); seen.add(key);
    return {
      sheet: c.sheet, ref: c.ref,
      ...(hasValue ? { value: c.value as OleCellValue } : {}),
      ...(hasStyle ? { style: c.style as OleCellStyle | null } : {}),
      ...(hasRich ? { richText: c.richText as OleRichRun[] | null } : {}),
    };
  }).sort((a, b) => a.sheet.localeCompare(b.sheet) || cellPosition(a.ref)[0] - cellPosition(b.ref)[0] || cellPosition(a.ref)[1] - cellPosition(b.ref)[1]);
  const paragraphs = state.paragraphs.map((p) => {
    if (!p || !Number.isInteger(p.index) || p.index < 0) throw new Error('OLE 段落无效');
    const hasText = typeof p.text === 'string', hasRuns = Array.isArray(p.runs);
    if (!hasText && !hasRuns) throw new Error('OLE 段落缺少变更');
    if (hasText && !validText(p.text)) throw new Error('OLE 段落无效');
    if (hasRuns) {
      if (!p.runs!.length || p.runs!.length > 100) throw new Error('OLE 段落 run 超限');
      const runSeen = new Set<number>();
      for (const r of p.runs!) {
        if (!r || !Number.isInteger(r.index) || r.index < 0 || !validText(r.text)) throw new Error('OLE 段落 run 无效');
        if (runSeen.has(r.index)) throw new Error('OLE 段落 run 重复'); runSeen.add(r.index);
      }
    }
    const key = 'p' + p.index; if (seen.has(key)) throw new Error('OLE 段落重复'); seen.add(key);
    return {
      index: p.index,
      ...(hasText ? { text: p.text } : {}),
      ...(hasRuns ? { runs: [...p.runs!].sort((a, b) => a.index - b.index) } : {}),
    };
  }).sort((a, b) => a.index - b.index);
  return { cells, paragraphs };
}

function addNs(parent: XmlElement, name: string, ns: string) {
  const n = createXmlElement(name, { attributes: [['xmlns', ns]] }); append(parent, n); return n;
}
function setNodeText(node: XmlElement, value: string) {
  for (const c of [...node.children]) removeXmlChild(node, c);
  append(node, createXmlText(value));
  setXmlAttribute(node, 'xml:space', 'preserve');
}

function applyDocxParagraph(p: XmlElement, edit: OleEdits['paragraphs'][number]) {
  if (!paragraphEditable(p)) throw new Error('段落含域、图形或修订，不能直接替换文字');
  if (edit.runs) {
    const runs = children(p, 'r');
    for (const change of edit.runs) {
      const r = runs[change.index]; if (!r) throw new Error('段落 run 不存在');
      let t = child(r, 't');
      if (!t) t = addNs(r, 't', W);
      setNodeText(t, change.text);
    }
    return;
  }
  // 整段替换：多 run 时只改第一个 run 的文字并清空后续 run，保留各自 rPr（相邻粗斜体等不丢）。
  const nodes = descendants(p, 't', W);
  if (!nodes.length) nodes.push(addNs(addNs(p, 'r', W), 't', W));
  nodes.forEach((node, i) => setNodeText(node, i ? '' : edit.text ?? ''));
}

function sameFont(a: OleCellStyle['font'] | undefined, b: OleCellStyle['font'] | undefined): boolean {
  return (a?.name ?? '') === (b?.name ?? '') && (a?.size ?? 0) === (b?.size ?? 0) && !!a?.bold === !!b?.bold
    && !!a?.italic === !!b?.italic && (a?.color ?? '') === (b?.color ?? '');
}
function sameFill(a: OleCellStyle['fill'] | undefined, b: OleCellStyle['fill'] | undefined): boolean {
  return (a?.color ?? '') === (b?.color ?? '');
}
function sameBorder(a: OleCellStyle['border'] | undefined, b: OleCellStyle['border'] | undefined): boolean {
  return (a?.color ?? '') === (b?.color ?? '') && (a?.style ?? '') === (b?.style ?? '');
}

function ensureStylesPart(pkg: EmbeddedPackage, changes: Record<string, Uint8Array | null>): { part: string; tree: ReturnType<typeof parseXmlTree> } {
  const relsPath = relPart(pkg.main);
  const rels = parseXmlTree(changes[relsPath] ?? pkg.parts[relsPath]);
  const types = parseXmlTree(changes['[Content_Types].xml'] ?? pkg.parts['[Content_Types].xml']);
  let rel = children(rels.root, 'Relationship').find((n) => attr(n, 'Type') === `${R}/styles` && attr(n, 'TargetMode') !== 'External');
  let part = rel ? resolvePart(pkg.main, attr(rel, 'Target')!) : resolvePart(pkg.main, 'styles.xml');
  if (!rel) {
    const id = 'styles';
    rel = createXmlElement('Relationship', { attributes: [['xmlns', 'http://schemas.openxmlformats.org/package/2006/relationships'], ['Id', id], ['Type', `${R}/styles`], ['Target', 'styles.xml']] });
    append(rels.root, rel);
    changes[relsPath] = serializeXmlTreeBytes(rels);
  }
  if (!children(types.root, 'Override').some((n) => attr(n, 'PartName') === '/' + part)) {
    append(types.root, createXmlElement('Override', { attributes: [['xmlns', 'http://schemas.openxmlformats.org/package/2006/content-types'], ['PartName', '/' + part], ['ContentType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml']] }));
    changes['[Content_Types].xml'] = serializeXmlTreeBytes(types);
  }
  const bytes = changes[part] ?? pkg.parts[part];
  if (bytes) return { part, tree: parseXmlTree(bytes) };
  const empty = parseXmlTree(new TextEncoder().encode(
    `<styleSheet xmlns="${SS}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>`
    + `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>`
    + `<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf/></cellXfs></styleSheet>`,
  ));
  return { part, tree: empty };
}

function ensureStyleIndex(pkg: EmbeddedPackage, changes: Record<string, Uint8Array | null>, style: OleCellStyle): number {
  const { part, tree } = ensureStylesPart(pkg, changes);
  const root = tree.root;
  const fontsEl = child(root, 'fonts') ?? addNs(root, 'fonts', SS);
  const fillsEl = child(root, 'fills') ?? addNs(root, 'fills', SS);
  const bordersEl = child(root, 'borders') ?? addNs(root, 'borders', SS);
  const xfsEl = child(root, 'cellXfs') ?? addNs(root, 'cellXfs', SS);
  const tables = readStyleTables(serializeXmlTreeBytes(tree))!;
  let fontId = tables.fonts.findIndex((f) => sameFont(f, style.font));
  if (fontId < 0 && style.font) {
    fontId = children(fontsEl, 'font').length;
    const font = addNs(fontsEl, 'font', SS);
    if (style.font.size !== undefined) { const sz = addNs(font, 'sz', SS); setXmlAttribute(sz, 'val', String(style.font.size)); }
    if (style.font.name) { const name = addNs(font, 'name', SS); setXmlAttribute(name, 'val', style.font.name); }
    if (style.font.bold) addNs(font, 'b', SS);
    if (style.font.italic) addNs(font, 'i', SS);
    if (style.font.color) { const color = addNs(font, 'color', SS); setXmlAttribute(color, 'rgb', style.font.color); }
    setXmlAttribute(fontsEl, 'count', String(fontId + 1));
  } else if (fontId < 0) fontId = 0;
  let fillId = tables.fills.findIndex((f) => sameFill(f, style.fill));
  if (fillId < 0 && style.fill?.color) {
    fillId = children(fillsEl, 'fill').length;
    const fill = addNs(fillsEl, 'fill', SS);
    const pattern = addNs(fill, 'patternFill', SS); setXmlAttribute(pattern, 'patternType', 'solid');
    const fg = addNs(pattern, 'fgColor', SS); setXmlAttribute(fg, 'rgb', style.fill.color);
    setXmlAttribute(fillsEl, 'count', String(fillId + 1));
  } else if (fillId < 0) fillId = 0;
  let borderId = tables.borders.findIndex((b) => sameBorder(b, style.border));
  if (borderId < 0 && style.border) {
    borderId = children(bordersEl, 'border').length;
    const border = addNs(bordersEl, 'border', SS);
    for (const side of ['left', 'right', 'top', 'bottom']) {
      const el = addNs(border, side, SS);
      if (style.border.style) setXmlAttribute(el, 'style', style.border.style);
      if (style.border.color) { const color = addNs(el, 'color', SS); setXmlAttribute(color, 'rgb', style.border.color); }
    }
    setXmlAttribute(bordersEl, 'count', String(borderId + 1));
  } else if (borderId < 0) borderId = 0;
  const existing = tables.xfs.findIndex((xf, i) => {
    if (xf.fontId !== fontId || xf.fillId !== fillId || xf.borderId !== borderId) return false;
    return sameFont(resolveStyle(tables, i)?.font, style.font) && sameFill(resolveStyle(tables, i)?.fill, style.fill)
      && sameBorder(resolveStyle(tables, i)?.border, style.border);
  });
  if (existing >= 0) { changes[part] = serializeXmlTreeBytes(tree); return existing; }
  const xf = createXmlElement('xf', { attributes: [['xmlns', SS], ['fontId', String(fontId)], ['fillId', String(fillId)], ['borderId', String(borderId)],
    ['applyFont', style.font ? '1' : '0'], ['applyFill', style.fill ? '1' : '0'], ['applyBorder', style.border ? '1' : '0']] });
  append(xfsEl, xf);
  setXmlAttribute(xfsEl, 'count', String(children(xfsEl, 'xf').length));
  changes[part] = serializeXmlTreeBytes(tree);
  return children(xfsEl, 'xf').length - 1;
}

function ensureSharedPart(pkg: EmbeddedPackage, changes: Record<string, Uint8Array | null>): { part: string; tree: ReturnType<typeof parseXmlTree> } {
  const relsPath = relPart(pkg.main);
  const rels = parseXmlTree(changes[relsPath] ?? pkg.parts[relsPath]);
  const types = parseXmlTree(changes['[Content_Types].xml'] ?? pkg.parts['[Content_Types].xml']);
  let rel = children(rels.root, 'Relationship').find((n) => attr(n, 'Type') === `${R}/sharedStrings` && attr(n, 'TargetMode') !== 'External');
  let part = rel ? resolvePart(pkg.main, attr(rel, 'Target')!) : resolvePart(pkg.main, 'sharedStrings.xml');
  if (!rel) {
    rel = createXmlElement('Relationship', { attributes: [['xmlns', 'http://schemas.openxmlformats.org/package/2006/relationships'], ['Id', 'strings'], ['Type', `${R}/sharedStrings`], ['Target', 'sharedStrings.xml']] });
    append(rels.root, rel); changes[relsPath] = serializeXmlTreeBytes(rels);
  }
  if (!children(types.root, 'Override').some((n) => attr(n, 'PartName') === '/' + part)) {
    append(types.root, createXmlElement('Override', { attributes: [['xmlns', 'http://schemas.openxmlformats.org/package/2006/content-types'], ['PartName', '/' + part], ['ContentType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml']] }));
    changes['[Content_Types].xml'] = serializeXmlTreeBytes(types);
  }
  const bytes = changes[part] ?? pkg.parts[part];
  if (bytes) return { part, tree: parseXmlTree(bytes) };
  return { part, tree: parseXmlTree(new TextEncoder().encode(`<sst xmlns="${SS}" count="0" uniqueCount="0"/>`)) };
}

function writeRichShared(pkg: EmbeddedPackage, changes: Record<string, Uint8Array | null>, runs: OleRichRun[]): number {
  const { part, tree } = ensureSharedPart(pkg, changes);
  const si = addNs(tree.root, 'si', SS);
  for (const run of runs) {
    const r = addNs(si, 'r', SS);
    if (run.bold || run.italic || run.underline || run.size !== undefined || run.color) {
      const rPr = addNs(r, 'rPr', SS);
      if (run.bold) addNs(rPr, 'b', SS);
      if (run.italic) addNs(rPr, 'i', SS);
      if (run.underline) addNs(rPr, 'u', SS);
      if (run.size !== undefined) { const sz = addNs(rPr, 'sz', SS); setXmlAttribute(sz, 'val', String(run.size)); }
      if (run.color) { const color = addNs(rPr, 'color', SS); setXmlAttribute(color, 'rgb', run.color); }
    }
    setNodeText(addNs(r, 't', SS), run.text);
  }
  const count = children(tree.root, 'si').length;
  setXmlAttribute(tree.root, 'count', String(count));
  setXmlAttribute(tree.root, 'uniqueCount', String(count));
  changes[part] = serializeXmlTreeBytes(tree);
  return count - 1;
}

export function editOleParts(pkg: EmbeddedPackage, edits: OleEdits): Record<string, Uint8Array | null> {
  const changes: Record<string, Uint8Array | null> = Object.create(null);
  if (pkg.kind === 'docx') {
    if (edits.cells.length) throw new Error('文档不支持单元格编辑');
    const main = parseXmlTree(pkg.parts[pkg.main]), paragraphs = descendants(main.root, 'p', W);
    for (const edit of edits.paragraphs) {
      const p = paragraphs[edit.index]; if (!p) throw new Error('段落不存在');
      applyDocxParagraph(p, edit);
    }
    if (edits.paragraphs.length) changes[pkg.main] = serializeXmlTreeBytes(main);
    return changes;
  }
  if (edits.paragraphs.length) throw new Error('表格不支持文档段落编辑');
  const list = sheets(pkg), trees = new Map<string, ReturnType<typeof parseXmlTree>>();
  let touchedCalc = false;
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
    if ('style' in edit) {
      if (edit.style === null) removeXmlAttribute(c, 's');
      else setXmlAttribute(c, 's', String(ensureStyleIndex(pkg, changes, edit.style!)));
    }
    if ('richText' in edit) {
      for (const node of xmlElementChildren(c)) if (['f', 'v', 'is'].includes(node.localName)) removeXmlChild(c, node);
      removeXmlAttribute(c, 't');
      if (edit.richText === null) {
        // 清除富文本但保留现有值语义：写入空字符串
        setXmlAttribute(c, 't', 'inlineStr');
        const n = addNs(addNs(c, 'is', SS), 't', SS); setNodeText(n, '');
      } else {
        const index = writeRichShared(pkg, changes, edit.richText!);
        setXmlAttribute(c, 't', 's');
        append(addNs(c, 'v', SS), createXmlText(String(index)));
      }
      touchedCalc = true;
    } else if ('value' in edit) {
      for (const node of xmlElementChildren(c)) if (['f', 'v', 'is'].includes(node.localName)) removeXmlChild(c, node);
      removeXmlAttribute(c, 't');
      if (edit.value !== null && edit.value !== undefined) {
        setXmlAttribute(c, 't', typeof edit.value === 'string' ? 'inlineStr' : typeof edit.value === 'boolean' ? 'b' : 'n');
        const n = typeof edit.value === 'string' ? addNs(addNs(c, 'is', SS), 't', SS) : addNs(c, 'v', SS);
        append(n, createXmlText(typeof edit.value === 'boolean' ? edit.value ? '1' : '0' : String(edit.value)));
        if (typeof edit.value === 'string') setXmlAttribute(n, 'xml:space', 'preserve');
      }
      touchedCalc = true;
    }
    const dimension = child(tree.root, 'dimension'); if (dimension) removeXmlChild(tree.root, dimension);
    removeXmlAttribute(row, 'spans');
  }
  for (const [part, tree] of trees) changes[part] = serializeXmlTreeBytes(tree);
  if (touchedCalc) {
    const main = parseXmlTree(changes[pkg.main] ?? pkg.parts[pkg.main]); let calc = child(main.root, 'calcPr');
    if (!calc) { calc = createXmlElement('calcPr', { attributes: [['xmlns', SS]] }); const order = ['oleSize', 'customWorkbookViews', 'pivotCaches', 'smartTagPr', 'smartTagTypes', 'webPublishing', 'fileRecoveryPr', 'webPublishObjects', 'extLst']; append(main.root, calc, xmlElementChildren(main.root).find((n) => order.includes(n.localName)) ?? null); }
    setXmlAttribute(calc, 'fullCalcOnLoad', '1'); setXmlAttribute(calc, 'forceFullCalc', '1'); setXmlAttribute(calc, 'calcMode', 'auto');
    changes[pkg.main] = serializeXmlTreeBytes(main);
    const rels = parseXmlTree(changes[relPart(pkg.main)] ?? pkg.parts[relPart(pkg.main)]), types = parseXmlTree(changes['[Content_Types].xml'] ?? pkg.parts['[Content_Types].xml']);
    for (const r of children(rels.root, 'Relationship')) if (attr(r, 'Type') === `${R}/calcChain`) {
      const part = resolvePart(pkg.main, attr(r, 'Target')!); changes[part] = null; removeXmlChild(rels.root, r);
      for (const declaration of children(types.root, 'Override')) if (attr(declaration, 'PartName') === '/' + part) removeXmlChild(types.root, declaration);
    }
    changes[relPart(pkg.main)] = serializeXmlTreeBytes(rels); changes['[Content_Types].xml'] = serializeXmlTreeBytes(types);
  }
  return changes;
}
