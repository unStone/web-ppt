/** 只读 ChartEx 语料探针：区分源文件有回退与公开解析/渲染实际采用回退。 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { parse, renderSlideToSvg } from '../packages/core/dist/core.js';
import { parseXmlTree, xmlElementChildren } from '../packages/edit-core/dist/xml.js';
import { chartWorkbook } from './lib/chartex-workbook-probe.mjs';
import { relationships } from './lib/chartex-probe-opc.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'fixtures/chartex-corpus.json'), 'utf8'));
const CX = 'http://schemas.microsoft.com/office/drawing/2014/chartex';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const SS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const artifacts = Object.fromEntries(['core/dist/core.js', 'edit-core/dist/xml.js'].map((path) =>
  [path, hash(readFileSync(resolve(root, 'packages', path)))]));
const attr = (node, name, namespaceUri = null) => node?.attributes.find((a) =>
  a.localName === name && a.namespaceUri === namespaceUri)?.value ?? null;
const text = (node) => node.children.map((n) => n.type === 'element' ? text(n) : n.value ?? '').join('');
function* walk(node, parents = []) {
  yield { node, parents };
  for (const child of xmlElementChildren(node)) yield* walk(child, [...parents, node]);
}
const descendants = (node, name, ns) => [...walk(node)].map((entry) => entry.node)
  .filter((n) => n.localName === name && (ns === undefined || n.namespaceUri === ns));
const children = (node, name, ns) => node ? xmlElementChildren(node, { localName: name, namespaceUri: ns }) : [];

function inspectChart(part, tree, parts) {
  const rels = relationships(parts, part);
  const workbook = chartWorkbook(parts, part, tree);
  return {
    part, namespace: tree.namespaceUri,
    rootAttributes: tree.attributes.filter((a) => a.namespaceUri !== XMLNS)
      .map(({ name, value }) => ({ name, value })),
    relationships: rels,
    workbookSource: workbook.source,
    series: descendants(tree, 'series', CX).map((series) => ({
      layoutId: attr(series, 'layoutId'), hidden: attr(series, 'hidden'),
      dataId: attr(children(series, 'dataId', CX)[0], 'val'),
      layoutProperties: descendants(series, 'layoutPr', CX).flatMap((n) =>
        xmlElementChildren(n).map((child) => child.localName)),
    })),
    dimensions: descendants(tree, 'chartData', CX).flatMap((data) =>
      descendants(data, 'data', CX).flatMap((entry) => xmlElementChildren(entry)
        .filter((n) => n.namespaceUri === CX && (n.localName === 'strDim' || n.localName === 'numDim'))
        .map((dim) => ({
          dataId: attr(entry, 'id'), kind: dim.localName, type: attr(dim, 'type'),
          formulas: descendants(dim, 'f', CX).map(text),
          workbookReferences: children(dim, 'f', CX).map((formula) => ({
            formula: text(formula), direction: attr(formula, 'dir') ?? 'col', ...workbook.resolve(text(formula)),
          })),
          levels: descendants(dim, 'lvl', CX).map((level) => ({
            ptCount: attr(level, 'ptCount'),
            points: descendants(level, 'pt', CX).map((pt) => ({ idx: attr(pt, 'idx'), value: text(pt) })),
          })),
        })))),
  };
}

function inspectEnvelope(part, tree, parts) {
  const rels = relationships(parts, part);
  return [...walk(tree)].filter(({ node }) => node.localName === 'AlternateContent' && node.namespaceUri === MC)
    .filter(({ node }) => descendants(node, 'chart', CX).length > 0)
    .map(({ node, parents }) => {
      const choices = children(node, 'Choice', MC).map((choice) => ({
        requires: (attr(choice, 'Requires') ?? '').trim().split(/\s+/).filter(Boolean).map((prefix) => {
          const owner = [...parents, node, choice].reverse()
            .find((p) => p.attributes.some((a) => a.name === `xmlns:${prefix}`));
          return { prefix, namespace: owner?.attributes.find((a) => a.name === `xmlns:${prefix}`)?.value ?? null };
        }),
        charts: descendants(choice, 'chart', CX).map((chart) => ({
          id: attr(chart, 'id', R), relationship: rels.find((rel) => rel.id === attr(chart, 'id', R)) ?? null,
        })),
      }));
      const fallback = children(node, 'Fallback', MC)[0];
      const pictures = fallback ? descendants(fallback, 'pic').map((pic) => {
        const cnv = descendants(pic, 'cNvPr')[0];
        const blip = descendants(pic, 'blip')[0];
        const rel = rels.find((r) => r.id === attr(blip, 'embed', R));
        const bytes = rel?.resolved && parts[rel.resolved];
        return { id: attr(cnv, 'id'), name: attr(cnv, 'name'), namespace: pic.namespaceUri,
          relationship: rel ?? null, imageSha256: bytes ? hash(bytes) : null };
      }) : [];
      return { part, choices, fallback: {
        present: !!fallback, children: fallback ? xmlElementChildren(fallback).map((n) => n.name) : [],
        pictures, texts: fallback ? descendants(fallback, 't').map(text) : [],
      } };
    });
}

function inspectWorkbook(parts) {
  if (!parts['xl/workbook.xml']) return null;
  return {
    definedNames: descendants(parseXmlTree(parts['xl/workbook.xml']).root, 'definedName', SS)
      .map((node) => ({ name: attr(node, 'name'), localSheetId: attr(node, 'localSheetId'), reference: text(node) })),
    // 这是原工作表统计，不把整表数字误称为某个图表系列，也不求值公式。
    sheets: Object.keys(parts).filter((part) => /^xl\/worksheets\/[^/]+\.xml$/.test(part)).sort().map((part) => {
      const cells = descendants(parseXmlTree(parts[part]).root, 'c', SS);
      const numbers = cells.filter((cell) => [null, 'n'].includes(attr(cell, 't')))
        .flatMap((cell) => children(cell, 'v', SS).filter((value) => text(value).trim() !== '')
          .map((value) => ({ cell: attr(cell, 'r'), value: Number(text(value)) })))
        .filter((cell) => Number.isFinite(cell.value));
      return { part, cells: cells.length, formulaCells: cells.filter((cell) => children(cell, 'f', SS).length).length,
        numericCells: numbers.length, negativeCells: numbers.filter((cell) => cell.value < 0),
        zeroCells: numbers.filter((cell) => cell.value === 0).map((cell) => cell.cell) };
    }),
  };
}

const flatten = (elements) => elements.flatMap((el) => [el, ...flatten(el.children ?? [])]);
async function inspectRendering(bytes, envelopes) {
  const presentation = await parse(bytes, { lazy: false, edit: true, keepPackage: true });
  try {
    return envelopes.flatMap((envelope) => envelope.fallback.pictures.map((picture) => {
      const slide = presentation.slides.find((s) => s.editInfo?.origin.part === envelope.part);
      const candidates = flatten(slide?.elements ?? []).filter((el) => String(el.id) === picture.id
        && el.editInfo?.origin?.part === envelope.part);
      const matching = candidates.filter((el) => el.kind === 'image' && el.w > 0 && el.h > 0
        && picture.imageSha256 && presentation.package?.assets?.[el.src]
        && hash(presentation.package.assets[el.src].bytes) === picture.imageSha256);
      const emitted = Object.fromEntries(['html', 'svg'].map((textMode) => {
        const svg = slide ? renderSlideToSvg(presentation, slide, { textMode }) : '';
        const emittedImages = svg ? descendants(parseXmlTree(svg).root, 'image', 'http://www.w3.org/2000/svg') : [];
        return [textMode, matching.some((el) => emittedImages.some((n) =>
          n.attributes.some((a) => a.localName === 'href' && a.value === el.src)))];
      }));
      return { part: envelope.part, id: picture.id, expectedImageSha256: picture.imageSha256,
        actualKinds: candidates.map((el) => el.kind), matchedImages: matching.length, emitted,
        // 出现在 SVG 字符串里不等于浏览器已解码且可见；视觉检查另行记录。
        browserVisibility: 'not-tested', standaloneImageDecode: 'not-tested' };
    }));
  } finally { presentation.dispose?.(); }
}

const args = process.argv.slice(2);
const expectFallback = args.includes('--expect-fallback');
const paths = args.filter((arg) => arg !== '--expect-fallback');
if (!paths.length || paths.some((path) => path.startsWith('--'))) {
  console.error('用法：node tooling/probe-chartex.mjs [--expect-fallback] <本地 pptx/xlsx>…');
  process.exit(2);
}
for (const input of paths) {
  try {
    const path = resolve(input);
    const bytes = readFileSync(path);
    const digest = hash(bytes);
    const source = manifest.files.find((entry) => entry.sha256 === digest && entry.bytes === bytes.length);
    const parts = unzipSync(bytes, { filter: (entry) => {
      if (entry.originalSize > 20 * 1024 * 1024) throw new Error(`part 超过调查上限：${entry.name}`);
      return true;
    } });
    const charts = [];
    const envelopes = [];
    for (const part of Object.keys(parts).filter((p) => p.endsWith('.xml')).sort()) {
      const tree = parseXmlTree(parts[part]).root;
      if (tree.namespaceUri === CX && tree.localName === 'chartSpace') charts.push(inspectChart(part, tree, parts));
      envelopes.push(...inspectEnvelope(part, tree, parts));
    }
    const isPptx = Object.hasOwn(parts, 'ppt/presentation.xml');
    const rendering = isPptx ? await inspectRendering(bytes, envelopes) : null;
    const passed = !!rendering?.length && rendering.every((r) => r.actualKinds.length === 1
      && r.matchedImages === 1 && r.emitted.html && r.emitted.svg);
    console.log(JSON.stringify({ file: relative(root, path), bytes: bytes.length, sha256: digest,
      artifacts,
      provenance: source ? { pin: manifest.pin, url: source.url, evidence: source.evidence } : null,
      container: isPptx ? 'pptx' : parts['xl/workbook.xml'] ? 'xlsx' : 'other-opc',
      charts, envelopes, workbook: inspectWorkbook(parts), rendering,
      fallbackSerialization: rendering?.length ? (passed ? 'pass' : 'fail') : 'not-applicable',
    }, null, 2));
    if (expectFallback && !passed) {
      console.error(`${basename(path)}：没有证据证明回退图片通过公开解析并进入两条 SVG 输出`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`${input}：${error.message}`);
    process.exitCode = 1;
  }
}
