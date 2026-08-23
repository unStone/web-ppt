/**
 * 大文件性能基准。
 *
 *   node tooling/bench.mjs [页数倍数] [--edit] [--json]
 *
 * 把 showcase.pptx 的页复制若干遍拼成大文件，测量解析与渲染耗时、内存占用。
 * 真实场景里 200 页 / 数十 MB 的演示文稿很常见，这里给出可复现的数量级参考。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { installDomEnv } from './lib/dom-env.mjs';
import { makeZip } from './lib/ooxml.mjs';

installDomEnv();
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync('npx', ['esbuild', join(root, 'packages/core/src/index.ts'), '--bundle', '--format=esm',
  '--platform=browser', '--log-level=error', `--outfile=${join(root, 'out/core/bench.mjs')}`], { cwd: root });
const lib = await import(`file://${join(root, 'out/core/bench.mjs')}?t=${Date.now()}`);
const editLib = EDIT_MODE() ? await (async () => {
  const file = join(root, 'out/core/bench-edit.mjs');
  execFileSync('npx', ['esbuild', join(root, 'packages/edit-core/src/index.ts'), '--bundle', '--format=esm',
    '--platform=browser', '--log-level=error',
    `--alias:@web-ppt/core/geometry=${join(root, 'packages/core/src/geometry/index.ts')}`,
    `--alias:@web-ppt/core=${join(root, 'packages/core/src/index.ts')}`, `--outfile=${file}`], { cwd: root });
  return import(`file://${file}?t=${Date.now()}`);
})() : null;
const editXmlLib = EDIT_MODE() ? await (async () => {
  const file = join(root, 'out/core/bench-edit-xml.mjs');
  execFileSync('npx', ['esbuild', join(root, 'packages/edit-core/src/xml/index.ts'), '--bundle', '--format=esm',
    '--platform=browser', '--log-level=error', `--outfile=${file}`], { cwd: root });
  return import(`file://${file}?t=${Date.now()}`);
})() : null;
const editOpcLib = EDIT_MODE() ? await (async () => {
  const file = join(root, 'out/core/bench-edit-opc.mjs');
  execFileSync('npx', ['esbuild', join(root, 'packages/edit-core/src/opc/index.ts'), '--bundle', '--format=esm',
    '--platform=browser', '--log-level=error', `--outfile=${file}`], { cwd: root });
  return import(`file://${file}?t=${Date.now()}`);
})() : null;
const editSaveLib = EDIT_MODE() ? await (async () => {
  const file = join(root, 'out/core/bench-edit-save.mjs');
  execFileSync('npx', ['esbuild', join(root, 'packages/edit-core/src/save/index.ts'), '--bundle', '--format=esm',
    '--platform=browser', '--log-level=error',
    `--alias:@web-ppt/core/geometry=${join(root, 'packages/core/src/geometry/index.ts')}`,
    `--alias:@web-ppt/core=${join(root, 'packages/core/src/index.ts')}`, `--outfile=${file}`], { cwd: root });
  return import(`file://${file}?t=${Date.now()}`);
})() : null;

function EDIT_MODE() { return process.argv.includes('--edit'); }
const JSON_MODE = process.argv.includes('--json');
const report = (message) => { if (!JSON_MODE) console.log(message); };

// 把 showcase 的页复制若干遍拼成大文件
const src = unzipSync(new Uint8Array(readFileSync(join(root, 'fixtures/showcase.pptx'))));
const dec = new TextDecoder();
const repeatArg = process.argv.slice(2).find((arg) => /^\d+$/.test(arg));
const REPEAT = Number(repeatArg ?? 30);
const EDIT = EDIT_MODE();
const entries = [];
const slideXmls = [];
for (let i = 1; i <= 7; i++) slideXmls.push(dec.decode(src[`ppt/slides/slide${i}.xml`]));
const slideRels = dec.decode(src['ppt/slides/_rels/slide1.xml.rels']);
let n = 0;
const sldIds = [], presRels = [];
for (let r = 0; r < REPEAT; r++) {
  for (let i = 0; i < 7; i++) {
    n++;
    entries.push([`ppt/slides/slide${n}.xml`, slideXmls[i]]);
    entries.push([`ppt/slides/_rels/slide${n}.xml.rels`, dec.decode(src[`ppt/slides/_rels/slide${i+1}.xml.rels`]) ]);
    sldIds.push(`<p:sldId id="${255+n}" r:id="rId${n+1}"/>`);
    presRels.push(`<Relationship Id="rId${n+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n}.xml"/>`);
  }
}
for (const [k,v] of Object.entries(src)) {
  if (/^ppt\/slides\//.test(k)) continue;
  if (k === 'ppt/presentation.xml' || k === 'ppt/_rels/presentation.xml.rels' || k === '[Content_Types].xml') continue;
  entries.push([k, v]);
}
let pres = dec.decode(src['ppt/presentation.xml']);
pres = pres.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${sldIds.join('')}</p:sldIdLst>`);
entries.push(['ppt/presentation.xml', pres]);
let rels = dec.decode(src['ppt/_rels/presentation.xml.rels']);
rels = rels.replace(/<Relationship Id="rId(?!1")[^>]*Target="slides\/[^>]*>/g, '');
rels = rels.replace('</Relationships>', presRels.join('') + '</Relationships>');
entries.push(['ppt/_rels/presentation.xml.rels', rels]);
let ct = dec.decode(src['[Content_Types].xml']);
ct = ct.replace(/<Override PartName="\/ppt\/slides\/[^>]*>/g, '');
ct = ct.replace('</Types>', Array.from({length:n},(_,i)=>`<Override PartName="/ppt/slides/slide${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('') + '</Types>');
entries.push(['[Content_Types].xml', ct]);

const big = makeZip(entries);
writeFileSync(join(root, 'out/core/big.pptx'), big);
report(`大文件：${n} 页，${(big.length/1024/1024).toFixed(1)} MB（${EDIT ? '编辑解析' : '只读解析'}）`);

const t0 = Date.now();
const p = await lib.parse(big, EDIT ? { edit: true, keepPackage: true } : undefined);
const parseMs = Date.now() - t0;
let els = 0;
let elementEditInfo = 0;
const editableGeoms = [];
const walk = (l) => { for (const e of l) {
  els++;
  if (e.editInfo) elementEditInfo++;
  if (e.editInfo?.geom) editableGeoms.push([e.editInfo.geom, e.w, e.h]);
  if (e.kind==='group') walk(e.children);
} };
for (const s of p.slides) walk(s.elements);
const metrics = {
  mode: EDIT ? 'edit' : 'readonly',
  pages: p.slides.length,
  elements: els,
  inputBytes: big.length,
  parseMs,
  defaultState: {
    slideEditInfo: p.slides.filter((slide) => !!slide.editInfo).length,
    elementEditInfo,
    package: !!p.package,
  },
};

let editDoc = null;
let retainedHistoryEditor = null;
if (EDIT && editLib) {
  const dt0 = performance.now();
  editDoc = editLib.createDoc(p, { idPrefix: 'bench-' });
  const createDocMs = performance.now() - dt0;
  const pt0 = performance.now();
  for (const slideId of editDoc.slideOrder) editLib.toSlide(editDoc, slideId);
  const projectionMs = performance.now() - pt0;
  const ct0 = performance.now();
  for (const slideId of editDoc.slideOrder) editLib.toSlide(editDoc, slideId);
  const cacheMs = performance.now() - ct0;
  metrics.editDoc = { createDocMs, projectionMs, cacheMs };
  report(`  EditDoc: 建模 ${createDocMs.toFixed(1)}ms · 冷投影 ${projectionMs.toFixed(1)}ms · 缓存 ${cacheMs.toFixed(2)}ms`);

  // 保存只会解析脏 part；这里故意把 210 页的全部 XML 都过一遍，给 500ms 保存预算留足余量。
  const xmlEntries = Object.entries(editDoc.package?.parts ?? {})
    .filter(([path]) => /\.(?:xml|rels|vml)$/i.test(path));
  let xmlRoundTripExact = 0;
  let xmlRoundTripBytes = 0;
  const xmlStart = performance.now();
  for (const [, bytes] of xmlEntries) {
    xmlRoundTripBytes += bytes.length;
    const output = editXmlLib.serializeXmlTreeBytes(editXmlLib.parseXmlTree(bytes));
    if (output.length === bytes.length && output.every((value, index) => value === bytes[index])) {
      xmlRoundTripExact++;
    }
  }
  const xmlRoundTripMs = performance.now() - xmlStart;
  metrics.editDoc.xmlRoundTripParts = xmlEntries.length;
  metrics.editDoc.xmlRoundTripExact = xmlRoundTripExact;
  metrics.editDoc.xmlRoundTripBytes = xmlRoundTripBytes;
  metrics.editDoc.xmlRoundTripMs = xmlRoundTripMs;
  report(`  全部 XML 保留回环: ${xmlEntries.length} part / ${(xmlRoundTripBytes / 1024 / 1024).toFixed(1)}MB / ` +
    `${xmlRoundTripMs.toFixed(1)}ms（逐字相同 ${xmlRoundTripExact}）`);

  if (editOpcLib && editSaveLib && editDoc.package) {
    const padding = new Uint8Array(50 * 1024 * 1024);
    for (let offset = 0; offset < padding.length; offset += 4096) padding[offset] = offset >>> 12;
    const expanded = editOpcLib.patchOpcPackage(editDoc.package, { 'ppt/media/benchmark.mp4': padding });
    editLib.replaceDocPackage(editDoc, expanded.package);
    const targetRecords = editDoc.slideOrder.slice(0, 3).map((slideId) => {
      const pending = [...editDoc.slides[slideId].children];
      while (pending.length) {
        const record = editDoc.elements[pending.shift()];
        if (record.meta.editable !== 'none' && record.meta.origin) return record;
        pending.unshift(...(record.children ?? []));
      }
      return null;
    });
    const targets = targetRecords.map((record) => record?.meta.origin?.part ?? '');
    const saveEditor = new editLib.Editor(editDoc);
    const saveStart = performance.now();
    for (const record of targetRecords) {
      if (!record) throw new Error('性能固件前三页缺少可写回元素');
      saveEditor.transaction((tx) => tx.exec(
        { type: 'SetXfrm', id: record.id, x: record.src.x + 1 },
      ), '保存性能采样', { recordHistory: false });
    }
    const saved = editSaveLib.saveEditDoc(editDoc);
    const saveMs = performance.now() - saveStart;
    metrics.editDoc.opcSaveInputBytes = expanded.bytes.length;
    metrics.editDoc.opcSaveOutputBytes = saved.bytes.length;
    metrics.editDoc.opcSaveDirtyParts = targets.length;
    metrics.editDoc.opcSaveTargets = targets;
    metrics.editDoc.opcSavePreservedEntries = saved.preservedEntries;
    metrics.editDoc.opcSaveMs = saveMs;
    report(`  50MB OPC 三页序列化并保存: ${(expanded.bytes.length / 1024 / 1024).toFixed(1)}MB / ` +
      `${saveMs.toFixed(1)}ms（直通 ${saved.preservedEntries}）`);
  }
  const target = Object.values(editDoc.elements).find((record) => record.meta.geom
    && record.meta.editable !== 'none');
  if (target) {
    const slideId = editLib.slideOfElement(editDoc, target.id);
    const elementPrefix = `bench-element-${target.id}-`;
    const incrementalOps = 10000;
    const originalX = target.src.x;
    const commandEditor = new editLib.Editor(editDoc);
    let incrementalChecksum = 0;
    const it0 = performance.now();
    for (let i = 0; i < incrementalOps; i++) {
      commandEditor.transaction((tx) => tx.exec(
        { type: 'SetXfrm', id: target.id, x: originalX + (i & 1) },
      ), '性能采样', { recordHistory: false });
      const element = editLib.effectiveElement(editDoc, target.id);
      const part = lib.renderElementToSvg(element, { idPrefix: elementPrefix });
      incrementalChecksum += part.markup.length + part.defs.length;
    }
    const incrementalMs = performance.now() - it0;
    metrics.editDoc.elementCommitOps = incrementalOps;
    metrics.editDoc.elementCommitRenderMs = incrementalMs;
    metrics.editDoc.elementCommitRenderMsPerOp = incrementalMs / incrementalOps;
    metrics.editDoc.elementChecksum = incrementalChecksum;
    report(`  脏元素提交并渲染: ${incrementalOps} 次 / ${incrementalMs.toFixed(1)}ms  (${(incrementalMs / incrementalOps).toFixed(3)}ms/次)`);

    // DOM 适配层会把每个元素的 defs 与 markup 作为同一分区替换；jsdom 比浏览器慢，
    // 仍把这段纳入 16ms 硬门槛，避免字符串很快但真正上屏很慢的假优化。
    const domOps = 500;
    const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const domStart = performance.now();
    for (let i = 0; i < domOps; i++) {
      commandEditor.transaction((tx) => tx.exec(
        { type: 'SetXfrm', id: target.id, x: originalX + (i & 1) },
      ), '性能采样', { recordHistory: false });
      const element = editLib.effectiveElement(editDoc, target.id);
      const part = lib.renderElementToSvg(element, { idPrefix: elementPrefix });
      host.innerHTML = `<defs>${part.defs}</defs>${part.markup}`;
    }
    const domMs = performance.now() - domStart;
    metrics.editDoc.elementDomOps = domOps;
    metrics.editDoc.elementCommitDomMs = domMs;
    metrics.editDoc.elementCommitDomMsPerOp = domMs / domOps;
    metrics.editDoc.elementDomNodes = host.childNodes.length;
    report(`  脏元素提交并替换 DOM: ${domOps} 次 / ${domMs.toFixed(1)}ms  (${(domMs / domOps).toFixed(3)}ms/次)`);

    const commitOps = 2000;
    const et0 = performance.now();
    for (let i = 0; i < commitOps; i++) {
      commandEditor.transaction((tx) => tx.exec(
        { type: 'SetXfrm', id: target.id, x: originalX + (i & 1) },
      ), '性能采样', { recordHistory: false });
      const slide = editLib.toSlide(editDoc, slideId);
      lib.renderSlideToSvg(p, slide, { idPrefix: 'bench-commit-' });
    }
    const commitMs = performance.now() - et0;
    delete target.ovr.x;
    editLib.invalidateElement(editDoc, target.id);
    metrics.editDoc.commitOps = commitOps;
    metrics.editDoc.commitRenderMs = commitMs;
    metrics.editDoc.commitRenderMsPerOp = commitMs / commitOps;
    report(`  单元素提交并重渲: ${commitOps} 次 / ${commitMs.toFixed(1)}ms  (${(commitMs / commitOps).toFixed(3)}ms/次)`);

    const historyOps = 200;
    const historyEditor = new editLib.Editor(editDoc, { historyLimit: historyOps });
    retainedHistoryEditor = historyEditor;
    for (let i = 0; i < historyOps; i++) {
      historyEditor.exec({ type: 'SetXfrm', id: target.id, x: originalX + i + 1 });
    }
    let historyChecksum = 0;
    const undoStart = performance.now();
    for (let i = 0; i < historyOps; i++) {
      const change = historyEditor.undo();
      for (const dirtySlide of change.dirtySlides) {
        historyChecksum += lib.renderSlideToSvg(p, editLib.toSlide(editDoc, dirtySlide),
          { idPrefix: 'bench-undo-' }).length;
      }
    }
    const undoMs = performance.now() - undoStart;
    const redoStart = performance.now();
    for (let i = 0; i < historyOps; i++) {
      const change = historyEditor.redo();
      for (const dirtySlide of change.dirtySlides) {
        historyChecksum += lib.renderSlideToSvg(p, editLib.toSlide(editDoc, dirtySlide),
          { idPrefix: 'bench-redo-' }).length;
      }
    }
    const redoMs = performance.now() - redoStart;
    metrics.editDoc.historyOps = historyOps;
    metrics.editDoc.undoRenderMsPerOp = undoMs / historyOps;
    metrics.editDoc.redoRenderMsPerOp = redoMs / historyOps;
    metrics.editDoc.historyBytes = historyEditor.history.byteSize;
    metrics.editDoc.historyChecksum = historyChecksum;
    report(`  200 组撤销/重做并重渲脏页: undo ${(undoMs / historyOps).toFixed(3)}ms/次 · ` +
      `redo ${(redoMs / historyOps).toFixed(3)}ms/次 · 历史 ${(historyEditor.history.byteSize / 1024).toFixed(1)}KB`);

    const rebaseOps = 1000;
    const rebaseStart = performance.now();
    for (let i = 0; i < rebaseOps; i++) {
      historyEditor.transaction((tx) => tx.exec(
        { type: 'SetXfrm', id: target.id, y: target.src.y + 1 + (i & 1) },
      ), '远端性能采样', { origin: 'peer', recordHistory: false });
    }
    const rebaseMs = performance.now() - rebaseStart;
    metrics.editDoc.historyRebaseOps = rebaseOps;
    metrics.editDoc.historyRebaseMsPerOp = rebaseMs / rebaseOps;
    report(`  200 组历史上的非冲突远端 rebase: ${rebaseOps} 次 / ` +
      `${(rebaseMs / rebaseOps).toFixed(3)}ms/次`);
  }

  const textTarget = Object.values(editDoc.elements).find((record) =>
    record.src.kind === 'shape' && record.src.text && !record.src.text.autoFitCompute)
    ?? Object.values(editDoc.elements).find((record) => record.src.kind === 'shape' && record.src.text);
  if (textTarget) {
    const element = editLib.effectiveElement(editDoc, textTarget.id);
    const text = element.kind === 'shape' ? element.text : null;
    if (text) {
      const textOps = 10000;
      let checksum = 0;
      const textStart = performance.now();
      for (let i = 0; i < textOps; i++) {
        checksum += lib.renderTextBodyToHtml(text, element.w, element.h).length;
      }
      const textMs = performance.now() - textStart;
      metrics.editDoc.textHtmlOps = textOps;
      metrics.editDoc.textHtmlRenderMs = textMs;
      metrics.editDoc.textHtmlRenderMsPerOp = textMs / textOps;
      metrics.editDoc.textHtmlChecksum = checksum;
      report(`  文本编辑 HTML: ${textOps} 次 / ${textMs.toFixed(1)}ms  (${(textMs / textOps).toFixed(3)}ms/次)`);

      // Safari / iOS 的 engine 模式按这个行盒做光标命中；默认路径必须包含逐字符 UTF-16 停靠点。
      let layoutChecksum = 0;
      const layoutStart = performance.now();
      for (let i = 0; i < textOps; i++) {
        const layout = lib.layoutText(text, element.w, element.h);
        layoutChecksum += layout.lines.length;
        for (const line of layout.lines) {
          layoutChecksum += line.segments.length;
          for (const segment of line.segments) layoutChecksum += segment.carets.length;
        }
      }
      const layoutMs = performance.now() - layoutStart;
      metrics.editDoc.textLayoutOps = textOps;
      metrics.editDoc.textLayoutMs = layoutMs;
      metrics.editDoc.textLayoutMsPerOp = layoutMs / textOps;
      metrics.editDoc.textLayoutChecksum = layoutChecksum;
      report(`  文本行盒与字符映射: ${textOps} 次 / ${layoutMs.toFixed(1)}ms  (${(layoutMs / textOps).toFixed(3)}ms/次)`);

      // 按键后的真实上屏还包括 HTML 解析；用独立宿主反复替换覆盖层，守住 30ms 预算。
      const textDomOps = 500;
      const host = document.createElement('div');
      const textDomStart = performance.now();
      for (let i = 0; i < textDomOps; i++) {
        host.innerHTML = lib.renderTextBodyToHtml(text, element.w, element.h);
      }
      const textDomMs = performance.now() - textDomStart;
      metrics.editDoc.textHtmlDomOps = textDomOps;
      metrics.editDoc.textHtmlDomMs = textDomMs;
      metrics.editDoc.textHtmlDomMsPerOp = textDomMs / textDomOps;
      metrics.editDoc.textHtmlDomNodes = host.childNodes.length;
      report(`  文本编辑 HTML 并替换 DOM: ${textDomOps} 次 / ${textDomMs.toFixed(1)}ms  (${(textDomMs / textDomOps).toFixed(3)}ms/次)`);
    }
  }
}

const t1 = Date.now();
if (editDoc && editLib) {
  for (const slideId of editDoc.slideOrder) lib.renderSlideToSvg(p, editLib.toSlide(editDoc, slideId));
} else {
  for (const s of p.slides) lib.renderSlideToSvg(p, s);
}
const renderAll = Date.now() - t1;

const t2 = Date.now();
lib.renderSlideToSvg(p, editDoc && editLib ? editLib.toSlide(editDoc, editDoc.slideOrder[0]) : p.slides[0]);
const renderOne = Date.now() - t2;

metrics.renderAllMs = renderAll;
metrics.renderOneMs = renderOne;
report(`  解析 ${p.slides.length} 页 / ${els} 元素: ${parseMs}ms  (${(parseMs / p.slides.length).toFixed(1)}ms/页)`);
report(`  全部渲染: ${renderAll}ms  (${(renderAll / p.slides.length).toFixed(1)}ms/页)`);
report(`  单页渲染: ${renderOne}ms`);

if (editableGeoms.length) {
  // 拉长到稳定可测的量级，避免 Date.now 的 1ms 分辨率掩盖单次重算成本。
  const rounds = Math.ceil(50000 / editableGeoms.length);
  const gt0 = performance.now();
  let geomOps = 0, checksum = 0;
  for (let round = 0; round < rounds; round++) {
    for (const [geom, w, h] of editableGeoms) {
      checksum += lib.resolveGeomPath(geom, w * 1.1, h * 0.9).d.length;
      geomOps++;
    }
  }
  const geomMs = performance.now() - gt0;
  metrics.geometry = { operations: geomOps, totalMs: geomMs, microsecondsPerOp: geomMs / geomOps * 1000, checksum };
  report(`  几何重算: ${geomOps} 次 / ${geomMs.toFixed(1)}ms  (${(geomMs / geomOps * 1000).toFixed(2)}µs/次，校验 ${checksum})`);
}

// 区分「峰值垃圾」与「真正驻留」：前者无害，后者才是大文件的隐患。
// 需要 --expose-gc 才能强制回收；没有就只报峰值。
const peak = process.memoryUsage().heapUsed;
metrics.memory = { peakBytes: peak, retainedBytes: null };
if (typeof global.gc === 'function') {
  global.gc();
  global.gc();
  const retained = process.memoryUsage().heapUsed;
  metrics.memory.retainedBytes = retained;
  metrics.memory.historyBytes = retainedHistoryEditor?.history.byteSize ?? 0;
  report(`  堆内存: 峰值 ${(peak / 1024 / 1024).toFixed(0)} MB · 回收后驻留 ${(retained / 1024 / 1024).toFixed(0)} MB` +
    `  (${(retained / 1024 / 1024 / p.slides.length).toFixed(2)} MB/页)`);
} else {
  report(`  堆内存: 峰值 ${(peak / 1024 / 1024).toFixed(0)} MB（加 --expose-gc 可测驻留量）`);
}
report('  注：Node 侧用 jsdom 解析 XML，内存显著高于浏览器原生 DOMParser，仅作趋势参考。');
if (JSON_MODE) process.stdout.write(JSON.stringify(metrics));
