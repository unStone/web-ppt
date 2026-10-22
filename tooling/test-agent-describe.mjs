import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { countedAssert } from './lib/counted-assert.mjs';

const { assert, record } = countedAssert('agentDescribe');
const root = resolve(import.meta.dirname, '..'), out = join(root, 'out/agent-describe');
mkdirSync(out, { recursive: true });
const dist = process.argv.includes('--dist');
const entry = join(out, 'entry.mjs');
writeFileSync(entry, `export * as core from ${JSON.stringify(join(root, 'packages/core/src/index.ts'))};
export * as edit from ${JSON.stringify(join(root, 'packages/edit-core/src/index.ts'))};
export * as describe from ${JSON.stringify(join(root, 'packages/edit-core/src/describe/index.ts'))};
export * as smartart from ${JSON.stringify(join(root, 'packages/edit-core/src/smartart/index.ts'))};`);
const api = dist ? {
  core: await import('@web-ppt/core'), edit: await import('@web-ppt/edit-core'),
  describe: await import('@web-ppt/edit-core/describe'),
  smartart: await import('@web-ppt/edit-core/smartart'),
} : await bundleBrowser({ root, entry, output: join(out, 'contract.mjs') });
const { core, edit, describe: { describePresentation, DescribeError } } = api;
const input = readFileSync(join(root, 'fixtures/sample-agent-describe.pptx'));
const pres = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
const doc = edit.createDoc(pres, { idPrefix: 'agent-' }), editor = new edit.Editor(doc);
const before = JSON.stringify(doc);
const full = describePresentation(doc);
assert.equal(JSON.stringify(doc), before, '查询不产生模型修改');
assert.equal(full.version, 1);
assert.equal(full.totalSlides, 2);
assert.equal(full.slides[1].hidden, true);
assert.equal(full.slides[0].notes, '备注 & Notes');
assert.equal(full.slides[0].section.name, '第一节');
const elements = full.slides[0].elements;
const title = elements.find((e) => e.name === '页面标题');
assert.equal(title.placeholder.type, 'title');
assert.equal(title.placeholder.index, '7');
assert.equal(doc.elements[title.placeholder.layout.elementId].src.name, '版式标题');
assert.equal(doc.elements[title.placeholder.master.elementId].src.name, '母版标题');
const child = elements.find((e) => e.name === '组内中文');
assert.deepEqual(child.bounds, { x: 140, y: 110, width: 160, height: 30 });
assert.equal(child.path.length, 2);
assert.equal(child.paragraphs[0].level, 2);
assert.equal(child.paragraphs[0].bullet.text, '•');
assert.equal(child.paragraphs[0].text, '中文 & "quotes" 😀');
assert.equal(full.truncation.reason, null);
const json = JSON.stringify(full);
assert.deepEqual(describePresentation(doc, { maxChars: json.length }), full);
assert.deepEqual(describePresentation(doc, { maxTokens: json.length, countTokens: (value) => value.length }), full);
for (const options of [
  { maxChars: json.length - 1 }, { maxTokens: json.length - 1, countTokens: (value) => value.length },
  { maxChars: Math.floor(json.length / 2), maxTokens: json.length, countTokens: (value) => value.length },
]) {
  const result = describePresentation(doc, options);
  assert(JSON.stringify(result).length <= (options.maxChars ?? options.maxTokens));
  assert(result.truncation.omittedElements > 0 || result.truncation.omittedSlides > 0);
  assert(result.truncation.next !== null);
  assert.equal(result.totalElements - result.slides.reduce((n, s) => n + s.elements.length, 0), result.truncation.omittedElements);
  assert.deepEqual(result, describePresentation(doc, options));
}
for (const [options, reason] of [
  [{ maxChars: -1 }, 'invalid-budget'], [{ maxChars: NaN }, 'invalid-budget'],
  [{ maxTokens: 3.5 }, 'invalid-budget'], [{ maxTokens: 100 }, 'token-counter-required'],
  [{ maxTokens: 100, countTokens: () => -1 }, 'invalid-token-count'],
  [{ maxTokens: 100, countTokens: () => { throw new Error('tokenizer unavailable'); } }, 'token-count-failed'],
  [null, 'invalid-budget'],
  [{ maxChars: 1 }, 'budget-too-small'],
]) assert.throws(() => describePresentation(doc, options), (e) => e instanceof DescribeError && e.reason === reason);
editor.exec({ type: 'SetName', id: title.id, name: '修改后标题' });
editor.exec({ type: 'SetAltText', id: title.id, title: '替代标题', descr: '替代描述' });
const changed = describePresentation(doc).slides[0].elements.find((e) => e.id === title.id);
assert.equal(changed.name, '修改后标题');
assert.deepEqual(changed.altText, { title: '替代标题', description: '替代描述' });
editor.undo(); editor.undo();
editor.exec({ type: 'EditText', id: title.id, ops: [{ type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 }, text: '修改' }] });
editor.exec({ type: 'SetNotes', id: full.slides[0].id, text: '当前备注' });
const editedText = describePresentation(doc).slides[0];
assert.equal(editedText.elements.find((element) => element.id === title.id).paragraphs[0].text, '修改可编辑标题');
assert.equal(editedText.notes, '当前备注');
editor.undo(); editor.undo();
assert.deepEqual(describePresentation(doc), full, '撤销后读取恢复来源');
const group = elements.find((e) => e.name === '缩放组合');
editor.exec({ type: 'SetXfrm', id: group.id, rot: 90 });
editor.exec({ type: 'SetFlip', id: group.id, h: true });
const rotated = describePresentation(doc).slides[0].elements.find((e) => e.id === child.id);
for (const [key, value] of Object.entries({ x: 310, y: 150, width: 30, height: 160 })) {
  assert(Math.abs(rotated.bounds[key] - value) < 1e-8, `旋转翻转组合包围盒 ${key}`);
}
editor.undo(); editor.undo();
editor.exec({ type: 'SetZ', id: title.id, to: 'front' });
const reordered = describePresentation(doc).slides[0].elements;
assert.equal(reordered.at(-1).id, title.id, '当前绘制序与稳定身份同步');
assert.equal(reordered.at(-1).name, '页面标题');
editor.undo();
const metadataBudget = describePresentation(doc, { maxChars: 550 });
assert(JSON.stringify(metadataBudget).length <= 550);
assert.equal(metadataBudget.truncation.omittedElements, full.totalElements);
assert(metadataBudget.truncation.next !== null);
const empty = describePresentation(edit.createEmptyDoc({ width: 100, height: 100, idPrefix: 'empty-' }));
assert.equal(empty.totalSlides, 0);
assert.equal(empty.truncation.next, null);
assert.throws(() => describePresentation({ ...doc, meta: { ...doc.meta, width: NaN } }), (e) => e.reason === 'invalid-document');
const invalid = structuredClone(doc);
invalid.elements[title.id].src.x = NaN;
assert.throws(() => describePresentation(invalid), (e) => e.reason === 'invalid-geometry' && e.elementId === title.id && e.slideNumber === 1);
pres.dispose(); editor.dispose();

const layoutPres = await core.parse(readFileSync(join(root, 'fixtures/sample-editor-change-layout.pptx')), { edit: true, keepPackage: true, lazy: false });
const layoutEditor = new edit.Editor(edit.createDoc(layoutPres, { idPrefix: 'layout-' }));
const slideId = layoutEditor.doc.slideOrder[0];
const targetLayout = layoutEditor.doc.layoutOrder.find((id) => layoutEditor.doc.layouts[id].name === '重点内容');
layoutEditor.exec({ type: 'SetLayout', id: slideId, layoutId: targetLayout });
const projected = describePresentation(layoutEditor.doc).slides[0];
assert.equal(projected.layout.name, '重点内容');
assert(!projected.elements.some((element) => element.name === '版式色带'), '旧继承节点退出当前结果');
const corner = projected.elements.find((element) => element.name === '目标版式角标');
assert.equal(corner.canvas.kind, 'layout');
assert.equal(corner.canvas.id, targetLayout);
for (const element of projected.elements) {
  layoutEditor.select({ kind: 'elements', ids: [element.id], enteredGroup: null });
  assert.deepEqual(layoutEditor.selection.ids, [element.id], '当前设计投影返回真实可选 ID');
}
const designTarget = { kind: 'layout', id: targetLayout };
layoutEditor.execDesign(designTarget, { type: 'AddShape', target: designTarget, preset: 'rect', rect: { x: 30, y: 40, w: 100, h: 60 } });
const designId = layoutEditor.selection.ids[0];
const addedDesign = describePresentation(layoutEditor.doc).slides[0].elements.find((element) => element.id === designId);
assert.deepEqual(addedDesign.bounds, { x: 30, y: 40, width: 100, height: 60 }, '新设计对象尚未保存时即可读取');
layoutPres.dispose(); layoutEditor.dispose();

const smartPres = await core.parse(readFileSync(join(root, 'fixtures/sample-smartart-edit.pptx')), { edit: true, keepPackage: true, lazy: false });
const smartEditor = new edit.Editor(edit.createDoc(smartPres, { idPrefix: 'smart-' }));
const smart = api.smartart.createSmartArtEditor(smartEditor);
const smartId = api.smartart.listEditableSmartArt(smartEditor.doc)[0].id;
const firstNode = smart.query(smartId)[0];
smart.addNode(smartId, firstNode.id, '新增 Agent 节点', '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}');
const smartDescription = describePresentation(smartEditor.doc).slides.flatMap((slide) => slide.elements);
const frame = smartDescription.find((element) => element.id === smartId);
assert(frame.paragraphs.some((paragraph) => paragraph.text.includes('新增 Agent 节点')), '框架对象的当前内部文字可读');
assert(!smartDescription.some((element) => element.path.length > 1 && element.path[0] === smartId), '框架对象的绘制子节点不冒充编辑目标');
smartPres.dispose(); smartEditor.dispose();

// 同一固定身份的文档在两个全新进程中读出，覆盖默认会话随机前缀与 blob 地址泄漏。
const runner = join(root, 'tooling/lib/agent-describe-process.mjs');
const first = execFileSync(process.execPath, [runner, dist ? '--dist' : '--source'], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const second = execFileSync(process.execPath, [runner, dist ? '--dist' : '--source'], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
assert.deepEqual(first, second, '全部固件跨进程逐字节一致');
const outputs = JSON.parse(first);
const fixtures = readdirSync(join(root, 'fixtures')).filter((name) => /\.(pptx|ppt)$/i.test(name)).sort();
assert.deepEqual(Object.keys(outputs), fixtures, '每份固件都必须参与');
const { default: Ajv } = await import('ajv');
const schema = JSON.parse(readFileSync(join(root, 'packages/edit-core/schemas/describe.schema.json'), 'utf8'));
const validate = new Ajv({ strict: true }).compile(schema);
assert(validate(full), '未截断结果符合发布 Schema');
assert(validate(metadataBudget), '截断结果符合发布 Schema');
assert(!validate({ ...full, version: 2 }), 'Schema 拒绝未知协议版本');
assert(!validate({ ...full, unexpected: true }), 'Schema 拒绝未声明字段');
for (const [name, result] of Object.entries(outputs)) {
  assert(validate(result), `${name}：${JSON.stringify(validate.errors)}`);
  assert(!JSON.stringify(result).includes('blob:'), `${name} 不泄漏不稳定的会话资源地址`);
}
const table = outputs['sample-editor-table-text.pptx'].slides.flatMap((slide) => slide.elements).find((element) => element.kind === 'table');
assert(table.paragraphs.some((paragraph) => paragraph.cell?.row === 1 && paragraph.cell.column === 1), '表格保留单元格地址');
writeFileSync(join(out, 'example.json'), `${JSON.stringify(full, null, 2)}\n`);
record();
console.log(`Agent describe ${fixtures.length} 份固件通过${dist ? '（独立产物）' : ''}`);
