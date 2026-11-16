import { countedAssert } from './lib/counted-assert.mjs';
const { assert, record } = countedAssert('smartartEdit');
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';
import { bundleBrowser } from './lib/bundle-browser.mjs';

const root = resolve(import.meta.dirname, '..'),
  out = join(root, 'out/smartart-edit');
mkdirSync(out, { recursive: true });
const entry = join(out, 'entry.mjs');
writeFileSync(
  entry,
  `export * as core from ${JSON.stringify(join(root, 'packages/core/src/index.ts'))};
export * as edit from ${JSON.stringify(join(root, 'packages/edit-core/src/index.ts'))};
export * as smartart from ${JSON.stringify(join(root, 'packages/edit-core/src/smartart/index.ts'))};`,
);
const { core, edit, smartart } = process.argv.includes('--dist')
  ? Object.fromEntries(
      await Promise.all(
        [
          ['core', 'core/dist/core.js'],
          ['edit', 'edit-core/dist/edit-core.js'],
          ['smartart', 'edit-core/dist/smartart.js'],
        ].map(async ([key, file]) => [key, await import(pathToFileURL(join(root, 'packages', file)))]),
      ),
    )
  : await bundleBrowser({
      root,
      entry,
      output: join(out, 'contract.mjs'),
      aliases: [
        ['@web-ppt/core/diagram-edit', join(root, 'packages/core/src/diagram-edit.ts')],
        ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
        ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
        ['@web-ppt/edit-core/opc', join(root, 'packages/edit-core/src/opc/index.ts')],
        ['@web-ppt/edit-core/xml', join(root, 'packages/edit-core/src/xml/index.ts')],
        ['@web-ppt/edit-core', join(root, 'packages/edit-core/src/index.ts')],
      ],
    });
const input = readFileSync(join(root, 'fixtures/sample-smartart-edit.pptx'));
const make = async (bytes = input, options = {}) => {
  const p = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(p, { idPrefix: 'diagram-' }), options);
  return { p, editor, api: smartart.createSmartArtEditor(editor) };
};
const text = (element) =>
  element.kind === 'group'
    ? element.children.map(text).join('|')
    : element.kind === 'shape'
      ? (element.text?.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n') ?? '')
      : '';
const decoder = new TextDecoder();
/** DiagramML / drawing 里的文本经 XML 转义；用 includes 比对时要对齐实体 */
const xmlText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

for (const generated of [false, true]) {
  const { p, editor, api } = await make(),
    frames = [];
  // 含 matrix1 / radial1 共八份：缓存页 + 六族自排（linear…radial）
  const items = smartart.listEditableSmartArt(editor.doc);
  assert.equal(items.length, 8);
  editor.subscribeRecovery((f) => frames.push(f));
  for (const [index, item] of items.entries()) {
    const nodes = api.query(item.id),
      first = nodes[0].id;
    api.setText(item.id, first, `修改文字 ${index} & <测试>`);
    assert(text(editor.effectiveElement(item.id)).includes(`修改文字 ${index} & <测试>`));
    const added = api.addNode(item.id, first, `新增子节点 ${index}`, `{00000000-0000-0000-0000-00000000000${index}}`);
    assert(api.query(item.id).some((n) => n.id === added && n.parentId === first));
    assert.throws(() => api.moveNode(item.id, first, added), /环/);
    api.moveNode(item.id, added, null, first);
    assert.equal(api.query(item.id)[0].id, added);
    api.removeNode(item.id, added);
    editor.undo();
    assert(api.query(item.id).some((n) => n.id === added));
  }
  if (generated) p.dispose();
  const bytes = await editor.save();
  writeFileSync(join(out, `${generated ? 'generated' : 'patched'}.pptx`), bytes);
  const parts = unzipSync(bytes),
    drawings = Object.keys(parts).filter((p) => /\/web-ppt-drawing-[^/]+\.xml$/.test(p));
  assert.equal(drawings.length, 8, '八份原生绘图缓存');
  const fresh = await make(bytes),
    reopened = smartart.listEditableSmartArt(fresh.editor.doc);
  for (const [index, item] of reopened.entries()) {
    assert(text(fresh.editor.effectiveElement(item.id)).includes(`修改文字 ${index} & <测试>`), '重开绘图包含新文字');
    assert(
      fresh.api.query(item.id).some((n) => n.text === `新增子节点 ${index}`),
      '数据模型保存新增节点',
    );
  }
  // 结构变更后必须重写 drawing：DiagramML 与缓存同含改字/新节点，不能残留旧几何文案
  const drawXmls = drawings.map((part) => decoder.decode(parts[part]));
  for (let index = 0; index < 8; index++) {
    const dataXml = decoder.decode(parts[`ppt/diagrams/data${index + 1}.xml`]);
    const edited = xmlText(`修改文字 ${index} & <测试>`);
    const added = xmlText(`新增子节点 ${index}`);
    assert(dataXml.includes(edited), `DiagramML data${index + 1} 含改字`);
    assert(dataXml.includes(added), `DiagramML data${index + 1} 含新节点`);
    assert(
      drawXmls.some((xml) => xml.includes(edited)),
      `drawing 缓存含改字 ${index}`,
    );
    assert(
      drawXmls.some((xml) => xml.includes(added)),
      `drawing 缓存含新节点 ${index}`,
    );
  }
  assert(decoder.decode(parts['ppt/diagrams/data1.xml']).includes('未知数据扩展'));
  assert.deepEqual(await editor.save(), bytes, '重复保存稳定');
  const recovered = await make(input, { recoveryFrames: frames });
  assert.deepEqual(recovered.api.query(smartart.listEditableSmartArt(recovered.editor.doc)[0].id), api.query(items[0].id));
  while (editor.history.undoCount) editor.undo();
  const undone = unzipSync(await editor.save());
  if (!generated) {
    assert.deepEqual(undone['ppt/diagrams/data1.xml'], unzipSync(input)['ppt/diagrams/data1.xml'], '保存后撤销恢复原数据');
    assert(!Object.keys(undone).some((part) => part.includes('web-ppt-drawing-')), '撤销删除生成的绘图缓存');
  }
  for (const value of [{ p, editor }, fresh, recovered]) {
    value.p.dispose();
    value.editor.dispose();
  }
}
record();
console.log('SmartArt：文字、增删节点、重排（含 matrix / radial）、父子关系、循环拒绝、DiagramML 与 drawing 一致、历史恢复通过');

// 可选真实语料（不计入确定性断言数）：cycle4 走布局定义引擎，编辑后保存的 drawing 写出旋转与多点合并文本
const cycle = join(root, 'corpus/libreoffice-smartart/smartart-cycle-matrix.pptx');
if (existsSync(cycle)) {
  const { p, editor, api } = await make(readFileSync(cycle));
  const [item] = smartart.listEditableSmartArt(editor.doc);
  const a1 = api.query(item.id).find((n) => n.text === 'A1');
  api.setText(item.id, a1.id, 'A1 已改');
  const files = unzipSync(await editor.save());
  const drawingKey = Object.keys(files).find((k) => /diagrams\/web-ppt-drawing-[^/]*\.xml$/.test(k));
  assert(drawingKey, 'cycle4 保存生成新的 drawing');
  const drawing = decoder.decode(files[drawingKey]);
  for (const rot of [5400000, 10800000, 16200000]) assert(drawing.includes(`<a:xfrm rot="${rot}">`), `cycle4 drawing 写出 rot=${rot}`);
  const shapes = drawing.split('<dsp:sp ').slice(1);
  const merged = shapes.find((s) => ['C2-1', 'C2-2', 'C2-3', 'C2-4'].every((t) => s.includes(`<a:t>${t}</a:t>`)));
  assert(merged, 'cycle4 C2 的四个数据点文本合并在同一个形状');
  const ids = shapes.map((s) => s.match(/modelId="([^"]+)"/)[1]);
  assert.equal(new Set(ids).size, ids.length, 'cycle4 drawing 的 modelId 唯一');
  assert(/<a:t[^>]*>A1 已改<\/a:t>/.test(drawing), 'cycle4 编辑后的文字写入 drawing');
  // dgm:extLst 里的扩展是 a:ext：复用原有的 dataModelExt 指向新 drawing，不追加重复扩展，也不写 dgm:ext
  const model = decoder.decode(files[Object.keys(files).find((k) => /diagrams\/data\d*\.xml$/.test(k))]);
  const pointers = model.match(/<dsp:dataModelExt [^>]*relId="([^"]+)"/g) ?? [];
  assert.equal(pointers.length, 1, 'cycle4 数据模型只有一个 dataModelExt');
  assert(pointers[0].includes('relId="webPptSmartArt'), 'cycle4 dataModelExt 指向保存生成的 drawing');
  assert(!/<dgm:ext[\s>]/.test(model), 'cycle4 数据模型不写 dgm:ext');
  p.dispose();
  editor.dispose();
  console.log(`SmartArt 真实语料：cycle4 引擎排布保存回环通过（${shapes.length} 个形状）`);
}
