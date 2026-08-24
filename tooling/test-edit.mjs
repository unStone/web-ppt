/** @web-ppt/edit-core 的身份、投影、缓存与包边界契约测试。 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDomEnv } from './lib/dom-env.mjs';
import { runCommandHistoryContract } from './lib/command-history-contract.mjs';
import { runElementDeleteContract } from './lib/element-delete-contract.mjs';
import { runElementDeleteSaveContract } from './lib/element-delete-save-contract.mjs';
import { runElementLayerContract } from './lib/element-layer-contract.mjs';
import { runElementLayerSaveContract } from './lib/element-layer-save-contract.mjs';
import { runElementAlignContract } from './lib/element-align-contract.mjs';
import { runElementClipboardContract } from './lib/element-clipboard-contract.mjs';
import { runTextEditContract } from './lib/text-edit-contract.mjs';
import { runRunFormatContract } from './lib/run-format-contract.mjs';
import { runParagraphFormatContract } from './lib/paragraph-format-contract.mjs';
import { runRichTextClipboardContract } from './lib/rich-text-clipboard-contract.mjs';
import { runTableCellTextContract } from './lib/table-cell-text-contract.mjs';
import { runTableRowInsertContract } from './lib/table-row-insert-contract.mjs';
import { runAutofitTextContract } from './lib/autofit-text-contract.mjs';
import { runShapeAutofitEditContract } from './lib/shape-autofit-edit-contract.mjs';
import { runBodyPropsEditContract } from './lib/body-props-edit-contract.mjs';
import { runCommandPropertyContract } from './lib/command-property-contract.mjs';
import { runModelInvariantContract } from './lib/model-invariant-contract.mjs';
import { runXmlTreeContract } from './lib/xml-tree-contract.mjs';
import { runOpcZipContract } from './lib/opc-zip-contract.mjs';
import { runSetXfrmSaveContract } from './lib/set-xfrm-save-contract.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out/edit');
mkdirSync(out, { recursive: true });
installDomEnv();

const bundle = (entry, name, aliases = []) => {
  const file = join(out, `${name}.mjs`);
  execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', '--platform=browser',
    '--log-level=error', ...aliases.map(([from, to]) => `--alias:${from}=${to}`), `--outfile=${file}`],
  { cwd: root, stdio: 'inherit' });
  return import(`file://${file}?t=${Date.now()}`);
};

const core = await bundle(join(root, 'packages/core/src/index.ts'), 'core');
const edit = await bundle(join(root, 'packages/edit-core/src/index.ts'), 'edit-core', [
  ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
  ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
]);
const editXml = await bundle(join(root, 'packages/edit-core/src/xml/index.ts'), 'edit-xml');
const editOpc = await bundle(join(root, 'packages/edit-core/src/opc/index.ts'), 'edit-opc');
const editSave = await bundle(join(root, 'packages/edit-core/src/save/index.ts'), 'edit-save', [
  ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
  ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
]);

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed++; return true; }
  failures.push(detail ? `${name} — ${detail}` : name);
  return false;
};
const eq = (name, actual, expected) =>
  check(name, Object.is(actual, expected), `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
const load = (name) => {
  const file = join(root, 'fixtures', name);
  return existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
};
const walk = (elements, fn) => {
  for (const element of elements) {
    fn(element);
    if (element.kind === 'group') walk(element.children, fn);
  }
};
const sourceCount = (pres) => {
  let count = 0;
  for (const slide of pres.slides) walk(slide.elements, () => count++);
  return count;
};

await runElementDeleteContract({ edit, core, load, check });
await runElementLayerContract({ edit, core, load, check });
await runElementAlignContract({ edit, core, load, check });
await runElementClipboardContract({ edit, core, load, check });
await runTextEditContract({ edit, core, load, check });
await runRunFormatContract({ edit, core, load, check });
await runParagraphFormatContract({ edit, core, load, check });
await runRichTextClipboardContract({ edit, core, load, check });
await runTableCellTextContract({ edit, core, load, check });
await runTableRowInsertContract({ edit, core, load, check });
await runAutofitTextContract({ edit, core, load, check });
await runShapeAutofitEditContract({ edit, core, load, check });
await runBodyPropsEditContract({ edit, core, load, check });

console.log('\n\x1b[36m▸ 分数序\x1b[0m');
{
  const initial = Array.from({ length: 200 }, (_, i) => edit.initialFractionalIndex(i));
  check('初始分数序严格递增', initial.every((key, i) => i === 0 || initial[i - 1] < key));
  let keys = [edit.fractionalIndexBetween(null, null)];
  let seed = 0x5eed1234;
  for (let i = 0; i < 5000; i++) {
    // 固定种子的乱序插入同时覆盖头、尾和越来越窄的相邻区间，CI 结果仍完全确定。
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const at = seed % (keys.length + 1);
    const key = edit.fractionalIndexBetween(keys[at - 1] ?? null, keys[at] ?? null);
    keys.splice(at, 0, key);
  }
  check('五千次任意位置插入仍严格有序', keys.every((key, i) => i === 0 || keys[i - 1] < key));
  eq('分数序没有重复', new Set(keys).size, keys.length);
  const concurrentA = edit.fractionalIndexBetween(keys[100], keys[101], '01-client-a');
  const concurrentB = edit.fractionalIndexBetween(keys[100], keys[101], '01-client-b');
  check('同区间并发插入可用稳定判别串消除冲突', concurrentA !== concurrentB
    && keys[100] < concurrentA && concurrentA < keys[101]
    && keys[100] < concurrentB && concurrentB < keys[101]);
  let rejected = false;
  try { edit.fractionalIndexBetween('z', 'A'); } catch { rejected = true; }
  check('拒绝倒置边界', rejected);
}

console.log('\n\x1b[36m▸ EditDoc 建模\x1b[0m');
const bytes = load('showcase.pptx');
if (!bytes) failures.push('缺少 showcase.pptx');
else {
  const pres = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
  const doc = edit.createDoc(pres, { idPrefix: 'fixture-' });
  const same = edit.createDoc(pres, { idPrefix: 'fixture-' });

  eq('页数保持不变', doc.slideOrder.length, pres.slides.length);
  eq('扁平元素数与源树一致', Object.keys(doc.elements).length, sourceCount(pres));
  eq('相同前缀和输入产生相同页身份', JSON.stringify(same.slideOrder), JSON.stringify(doc.slideOrder));
  eq('相同前缀和输入产生相同元素身份', JSON.stringify(Object.keys(same.elements)), JSON.stringify(Object.keys(doc.elements)));
  eq('全部身份在文档内唯一', new Set([...doc.slideOrder, ...Object.keys(doc.elements)]).size,
    doc.slideOrder.length + Object.keys(doc.elements).length);
  check('带原包和回写锚点的 pptx 可编辑', doc.meta.readonly === false && !!doc.package);

  let parentOk = true, orderOk = true;
  for (const slideId of doc.slideOrder) {
    const ids = doc.slides[slideId].children;
    parentOk &&= ids.every((id) => doc.elements[id].parent === slideId);
    orderOk &&= ids.every((id, i) => i === 0 || doc.elements[ids[i - 1]].z < doc.elements[id].z);
  }
  for (const record of Object.values(doc.elements)) {
    if (!record.children) continue;
    parentOk &&= record.children.every((id) => doc.elements[id].parent === record.id);
    orderOk &&= record.children.every((id, i) => i === 0
      || doc.elements[record.children[i - 1]].z < doc.elements[id].z);
  }
  check('扁平元素父链完整', parentOk);
  check('每组兄弟的 z 与 children 顺序一致', orderOk);
  check('普通形状是完整编辑对象', Object.values(doc.elements)
    .some((record) => record.src.kind === 'shape' && record.meta.editable === 'full'));
  check('表格不是 graphicFrame 误判的框架对象', Object.values(doc.elements)
    .some((record) => record.src.kind === 'table' && record.meta.editable === 'full'));
  check('EditDoc 是纯数据，可 structuredClone', (() => {
    try {
      const clone = structuredClone(doc);
      return clone.slideOrder.length === doc.slideOrder.length
        && clone.identity.nextElement === doc.identity.nextElement;
    } catch { return false; }
  })());

  console.log('\n\x1b[36m▸ 有效投影与缓存\x1b[0m');
  let equivalent = true;
  for (let i = 0; i < doc.slideOrder.length; i++) {
    const options = { textMode: 'svg', idPrefix: `edit-doc-${i}-` };
    const direct = core.renderSlideToSvg(pres, pres.slides[i], options);
    const projected = core.renderSlideToSvg(pres, edit.toSlide(doc, doc.slideOrder[i]), options);
    if (direct !== projected) equivalent = false;
  }
  check('全部固件页的有效投影与直接预览逐字节相同', equivalent);
  const firstSlideId = doc.slideOrder[0];
  eq('页面投影命中缓存', edit.toSlide(doc, firstSlideId), edit.toSlide(doc, firstSlideId));

  const adjusted = Object.values(doc.elements).find((record) => record.src.kind === 'shape'
    && record.meta.geom?.preset === 'roundRect' && record.meta.geom.adj.adj === 10000);
  if (check('找到带显式 adj 的编辑形状', !!adjusted)) {
    const slideId = edit.slideOfElement(doc, adjusted.id);
    const oldSlide = edit.toSlide(doc, slideId);
    const otherSlideId = doc.slideOrder.find((id) => id !== slideId);
    const otherSlide = otherSlideId ? edit.toSlide(doc, otherSlideId) : null;
    const oldElement = edit.effectiveElement(doc, adjusted.id);
    const sourceWidth = adjusted.src.w;
    adjusted.ovr.w = sourceWidth * 1.7;
    const dirty = edit.invalidateElement(doc, adjusted.id);
    const nextElement = edit.effectiveElement(doc, adjusted.id);
    check('单元素失效精确报告元素和所属页', dirty.dirtyElements.has(adjusted.id)
      && dirty.dirtySlides.has(slideId));
    eq('覆盖改变有效宽度', nextElement.w, sourceWidth * 1.7);
    check('改变宽度后几何重新求值', nextElement.path !== oldElement.path);
    eq('覆盖不修改源值', adjusted.src.w, sourceWidth);
    check('所属页缓存失效', edit.toSlide(doc, slideId) !== oldSlide);
    if (otherSlideId) eq('无关页面缓存保持命中', edit.toSlide(doc, otherSlideId), otherSlide);
    delete adjusted.ovr.w;
    edit.invalidateElement(doc, adjusted.id);
    eq('删除覆盖恢复源几何', edit.effectiveElement(doc, adjusted.id).path, oldElement.path);
  }

  const group = Object.values(doc.elements).find((record) => record.src.kind === 'group'
    && record.meta.editable === 'full' && record.children?.length);
  if (check('找到可编辑普通组', !!group)) {
    const childId = group.children[0];
    const before = edit.effectiveElement(doc, group.id);
    const child = doc.elements[childId];
    child.ovr.x = child.src.x + 3;
    const dirty = edit.invalidateElement(doc, childId);
    check('子元素失效向组祖先传播', dirty.dirtyElements.has(childId) && dirty.dirtyElements.has(group.id));
    check('组投影随子元素重建', edit.effectiveElement(doc, group.id) !== before);
    delete child.ovr.x;
    edit.invalidateElement(doc, childId);
  }

  const slideRecord = doc.slides[firstSlideId];
  const beforeSlide = edit.toSlide(doc, firstSlideId);
  slideRecord.ovr.hidden = true;
  const slideDirty = edit.invalidateSlide(doc, firstSlideId);
  check('页覆盖只报告脏页', slideDirty.dirtyElements.size === 0 && slideDirty.dirtySlides.has(firstSlideId));
  check('页覆盖进入有效投影', edit.toSlide(doc, firstSlideId).hidden === true
    && edit.toSlide(doc, firstSlideId) !== beforeSlide);
  delete slideRecord.ovr.hidden;
  edit.invalidateSlide(doc, firstSlideId);

  const originalDocument = globalThis.document;
  globalThis.document = undefined;
  try {
    edit.invalidateAll(doc);
    check('无 document 时仍能建立和读取投影', edit.toSlide(doc, firstSlideId).elements.length > 0);
  } finally {
    globalThis.document = originalDocument;
  }

  const plain = await core.parse(bytes, { lazy: false });
  const readonlyDoc = edit.createDoc(plain, { idPrefix: 'readonly-' });
  check('缺少原包与锚点的 pptx 明确降级只读', readonlyDoc.meta.readonly === true && readonlyDoc.package === null);
  edit.disposeDoc(readonlyDoc);

  const pptBytes = load('showcase.ppt');
  if (pptBytes) {
    const legacy = await core.parse(pptBytes, { edit: true });
    const legacyDoc = edit.createDoc(legacy, { idPrefix: 'legacy-' });
    check('.ppt 进入可生成保存的编辑模型', legacyDoc.meta.readonly === false && legacyDoc.package === null);
    check('.ppt 的几何语义进入元素 meta', Object.values(legacyDoc.elements).some((r) => !!r.meta.geom));
  }

  const empty = edit.createEmptyDoc({ width: 1280, height: 720 });
  const otherEmpty = edit.createEmptyDoc({ width: 1280, height: 720 });
  check('空文档可编辑且没有伪原包', !empty.meta.readonly && empty.package === null
    && empty.slideOrder.length === 0);
  check('默认身份前缀在同一会话内不相撞', empty.identity.prefix !== otherEmpty.identity.prefix);
  const emptySlideId = edit.allocateSlideId(empty);
  const emptyElementId = edit.allocateElementId(empty);
  check('空文档保留可序列化的身份分配状态', emptySlideId.startsWith(empty.identity.prefix)
    && emptyElementId.startsWith(empty.identity.prefix) && empty.identity.nextSlide === 2
    && empty.identity.nextElement === 2);
  let invalidSize = false;
  try { edit.createEmptyDoc({ width: 0, height: 720 }); } catch { invalidSize = true; }
  check('空文档拒绝非法页面尺寸', invalidSize);

  const frameFiles = ['sample-chart.pptx', 'sample-smartart.pptx', 'sample-ole.pptx'];
  let framedFiles = 0, protectedChildren = 0;
  for (const name of frameFiles) {
    const frameBytes = load(name);
    if (!frameBytes) continue;
    const framePres = await core.parse(frameBytes, { edit: true, keepPackage: true, lazy: false });
    const frameDoc = edit.createDoc(framePres, { idPrefix: `${name}-` });
    const frames = Object.values(frameDoc.elements).filter((record) => record.meta.editable === 'frame');
    if (frames.length) framedFiles++;
    for (const record of frames) {
      if (record.children?.length && record.children.every((id) => frameDoc.elements[id].meta.editable === 'none')) {
        protectedChildren++;
      }
    }
    edit.disposeDoc(frameDoc);
  }
  eq('图表、SmartArt、OLE 分别产出框架编辑对象', framedFiles, frameFiles.length);
  check('框架对象内部派生节点不可独立编辑', protectedChildren >= 2);

  const originalHandle = doc.package;
  const lifecyclePart = 'ppt/slides/slide1.xml';
  const lifecycleBytes = new TextEncoder().encode(
    `${new TextDecoder().decode(originalHandle.parts[lifecyclePart])}<!--lifecycle-->`,
  );
  const lifecycleSaved = editOpc.patchOpcPackage(originalHandle, { [lifecyclePart]: lifecycleBytes });
  edit.replaceDocPackage(doc, lifecycleSaved.package);
  edit.disposeDoc(doc);
  edit.disposeDoc(doc);
  check('释放 EditDoc 会同时释放原包与最新保存包且幂等', originalHandle.disposed === true
    && lifecycleSaved.package.disposed === true && lifecycleSaved.package.bytes.length === 0
    && Object.keys(lifecycleSaved.package.parts).length === 0 && doc.package === null);
}

check('默认 edit-core 入口不捆绑保存期 XML 解析器', !('parseXmlTree' in edit));
check('默认 edit-core 入口不捆绑保存期 ZIP 补丁器', !('patchOpcPackage' in edit));
await runCommandHistoryContract({ edit, core, load, check, eq });
await runCommandPropertyContract({ edit, core, load, check, eq });
await runModelInvariantContract({ edit, core, load, check });
runXmlTreeContract({ edit: editXml, check, eq, root });
await runOpcZipContract({ opc: editOpc, core, load, check, eq });
await runSetXfrmSaveContract({ edit, save: editSave, core, load, check, eq });
await runElementDeleteSaveContract({ edit, core, load, check });
await runElementLayerSaveContract({ edit, core, load, check });

console.log('\n' + '─'.repeat(60));
if (failures.length) {
  console.error(`\x1b[31m✗ ${failures.length} 项失败 / 共 ${passed + failures.length} 项\x1b[0m`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`\x1b[32m✓ 全部 ${passed} 项 edit-core 断言通过\x1b[0m`);
}
