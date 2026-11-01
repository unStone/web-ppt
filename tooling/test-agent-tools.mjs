import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { countedAssert } from './lib/counted-assert.mjs';

const { assert, record } = countedAssert('agentTools');
const root = resolve(import.meta.dirname, '..');
const out = join(root, 'out/agent-tools');
mkdirSync(out, { recursive: true });
const dist = process.argv.includes('--dist');
const entry = join(out, 'entry.mjs');
writeFileSync(entry, `export * as core from ${JSON.stringify(join(root, 'packages/core/src/index.ts'))};
export * as nodeRender from ${JSON.stringify(join(root, 'packages/core/src/node-export.ts'))};
export * as edit from ${JSON.stringify(join(root, 'packages/edit-core/src/index.ts'))};
export * as agent from ${JSON.stringify(join(root, 'packages/edit-core/src/agent/index.ts'))};`);
const api = dist ? {
  core: await import('@web-ppt/core'), nodeRender: await import('@web-ppt/core/node'),
  edit: await import('@web-ppt/edit-core'), agent: await import('@web-ppt/edit-core/agent'),
} : await bundleBrowser({ root, entry, output: join(out, 'contract.mjs') });
const { core, edit, agent } = api;
const input = readFileSync(join(root, 'fixtures/sample-agent-tools.pptx'));
const session = await agent.openAgentSession(input, { idPrefix: 'agent-tools-' });
const doc = session.editor.doc;
const description = await session.call('describe', {});
assert(description.ok && description.value.version === 1);
const title = description.value.slides[0].elements.find((element) => element.name === '页面标题');
assert(title);
const tools = agent.listAgentTools();
assert.deepEqual(tools.map((tool) => tool.name), ['describe', 'element', 'lint', 'render', 'edit', 'undo', 'redo', 'save']);
assert(tools.every((tool) => tool.inputSchema.$ref));

const schema = agent.agentToolSchema;
const definitions = schema.definitions ?? schema.$defs;
for (const type of ['SetXfrmCommand', 'AddImageCommand', 'ReplaceImageCommand', 'SetBackgroundImageCommand', 'SetMasterTextStyleCommand']) {
  assert(definitions[type], `Schema 包含 ${type}`);
}
assert.equal(definitions.AddImageCommand.properties.bytes.type, 'string');
assert.equal(definitions.ReplaceImageCommand.properties.bytes.type, 'string');
assert.equal(definitions.SetBackgroundImageCommand.properties.bytes.type, 'string');

const style = await session.call('element', { id: title.id, query: 'fill' });
assert(style.ok && style.value.id === title.id && typeof style.value.value.direct === 'boolean');
const lint = await session.call('lint', { checks: ['off-canvas'] });
assert(lint.ok && lint.value.checks.join() === 'off-canvas');

const snapshot = () => JSON.stringify({ doc, undo: session.editor.history.undoEntries, redo: session.editor.history.redoEntries });
for (const test of [
  { input: { commands: [{ type: 'SetName', id: title.id, name: 'x', extra: true }] }, reason: 'invalid-input' },
  { input: { commands: [{ type: 'SetName', id: 'missing-element', name: 'x' }] }, reason: 'target-not-found' },
  { input: { commands: [{ type: 'SetXfrm', id: title.id, w: -1 }] }, reason: 'command-rejected' },
  { input: { commands: [{ type: 'SetName', id: title.id, name: 'x' }, { type: 'SetXfrm', id: title.id, w: -2 }] }, reason: 'command-rejected', index: 1 },
  { input: { commands: [{ type: 'AddShape', slideId: doc.slideOrder[0], preset: 'rect', rect: { x: 1, y: 2, w: 30, h: 40 } }, { type: 'SetXfrm', id: title.id, w: -3 }] }, reason: 'command-rejected', index: 1 },
  { input: { commands: [{ type: 'SetZ', id: title.id, to: 'front' }, { type: 'SetZ', id: description.value.slides[1].elements[0].id, to: 'front' }] }, reason: 'command-rejected', index: 1 },
  { input: { commands: [{ type: 'ReplaceImage', id: title.id, bytes: 'not base64!', mime: 'image/png' }] }, reason: 'invalid-base64' },
]) {
  const before = snapshot();
  const result = await session.call('edit', test.input);
  assert(!result.ok && result.error.reason === test.reason, `${test.reason}: ${JSON.stringify(result)}`);
  assert.equal(result.error.commandIndex, test.index ?? 0);
  assert.equal(snapshot(), before, `${test.reason} 文稿与历史原子不变`);
}
const emptyBatch = await session.call('edit', { commands: [] });
assert(!emptyBatch.ok && emptyBatch.error.reason === 'invalid-input');

const originalName = doc.elements[title.id].src.name;
const originalText = description.value.slides[0].elements.find((element) => element.id === title.id).paragraphs[0].text;
const edited = await session.call('edit', { commands: [
  { type: 'SetName', id: title.id, name: 'Agent 批量标题' },
  { type: 'EditText', id: title.id, ops: [{ type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 }, text: '批量' }] },
], lint: { checks: ['off-canvas'] } });
assert(edited.ok, JSON.stringify(edited));
assert(edited.value.affectedElements.includes(title.id));
assert.deepEqual(edited.value.affectedSlides, [doc.slideOrder[0]]);
assert.equal(edited.value.lint.status, 'ok');
assert(edited.value.lint.report.issues.every((issue) => issue.slideNumber === 1));
assert.equal(session.editor.history.undoCount, 1);
const afterEdit = await session.call('describe', {});
assert(afterEdit.value.slides[0].elements.find((element) => element.id === title.id).paragraphs[0].text !== originalText);
const undone = await session.call('undo', {});
assert(undone.ok && session.editor.history.undoCount === 0 && session.editor.history.redoCount === 1);
const afterUndo = await session.call('describe', {});
assert.equal(afterUndo.value.slides[0].elements.find((element) => element.id === title.id).name, originalName);
assert.equal(afterUndo.value.slides[0].elements.find((element) => element.id === title.id).paragraphs[0].text, originalText);
const redone = await session.call('redo', {});
assert(redone.ok && session.editor.history.undoCount === 1 && session.editor.history.redoCount === 0);
const noHistory = await session.call('redo', {});
assert(!noHistory.ok && noHistory.error.reason === 'no-history');

const saved = await session.call('save', {});
assert(saved.ok && saved.value.saveMode === 'patch');
const savedBytes = Uint8Array.from(atob(saved.value.bytes), (char) => char.charCodeAt(0));
writeFileSync(join(out, 'patch.pptx'), savedBytes);
const reopened = await core.parse(savedBytes, { lazy: false });
assert.equal(reopened.slides[0].elements.find((element) => element.name === 'Agent 批量标题')?.name, 'Agent 批量标题');
reopened.dispose();

const generatedSource = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
const generatedDoc = edit.createDoc(generatedSource, { idPrefix: 'agent-tools-generated-' });
const generatedTitle = Object.values(generatedDoc.elements).find((element) => element.src.name === '页面标题').id;
const generatedSession = agent.createAgentSession(generatedDoc, { lint: { checks: ['off-canvas'] } });
generatedSource.dispose();
const generatedEdit = await generatedSession.call('edit', { commands: [{ type: 'SetName', id: generatedTitle, name: 'Agent 生成标题' }] });
assert(generatedEdit.ok);
const generated = await generatedSession.call('save', {});
assert(generated.ok && generated.value.saveMode === 'generated');
const generatedBytes = Uint8Array.from(atob(generated.value.bytes), (char) => char.charCodeAt(0));
writeFileSync(join(out, 'generated.pptx'), generatedBytes);
const generatedPres = await core.parse(generatedBytes, { lazy: false });
assert(generatedPres.slides[0].elements.some((element) => element.name === 'Agent 生成标题'));
generatedPres.dispose();
generatedSession.dispose();

const renderMissing = await session.call('render', { slideNumber: 1, format: 'svg' });
assert(!renderMissing.ok && renderMissing.error.reason === 'node-measure-required');
session.dispose();

const measureText = (text, run, scale) => [...text].reduce((width, char) => width + (char.codePointAt(0) > 255 ? 1 : .55) * run.size * scale, 0);
const renderedSession = await agent.openAgentSession(input, { idPrefix: 'agent-tools-render-', measureText });
const rendered = await renderedSession.call('render', { slideNumber: 1, format: 'svg' });
assert(rendered.ok && rendered.value.data.includes('<svg') && !rendered.value.data.includes('foreignObject'));
renderedSession.dispose();
writeFileSync(join(out, 'contract.json'), `${JSON.stringify({ tools, edited }, null, 2)}\n`);
record();
console.log(`Agent 命令工具面通过${dist ? '（独立产物）' : ''}`);
