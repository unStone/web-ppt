import { countedAssert } from './lib/counted-assert.mjs';
const {assert,record}=countedAssert('commentEdit');
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { bundleBrowser } from './lib/bundle-browser.mjs';

const root = resolve(import.meta.dirname, '..'), out = join(root, 'out/comment-edit');
mkdirSync(out, { recursive: true });
const entry = join(out, 'entry.mjs');
writeFileSync(entry, `export * as core from ${JSON.stringify(join(root, 'packages/core/src/index.ts'))};
export * as edit from ${JSON.stringify(join(root, 'packages/edit-core/src/index.ts'))};
export * as comments from ${JSON.stringify(join(root, 'packages/edit-core/src/comments/index.ts'))};`);
const { core, edit, comments } = process.argv.includes('--dist') ? Object.fromEntries(await Promise.all([["core", "@web-ppt/core"], ["edit", "@web-ppt/edit-core"], ["comments", "@web-ppt/edit-core/comments"]].map(async ([key, path]) => [key, await import(path)]))) : await bundleBrowser({ root, entry, output: join(out, 'contract.mjs'), aliases: [
  ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
  ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
  ['@web-ppt/edit-core', join(root, 'packages/edit-core/src/index.ts')],
] });
const input = readFileSync(join(root, 'fixtures/sample-comment-edit.pptx'));
const make = async (options) => {
  const p = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(p, { idPrefix: 'comments-' }), options);
  return { p, editor, api: comments.createCommentEditor(editor), slide: editor.doc.slideOrder[0] };
};
for (const generated of [false, true]) {
  const { p, editor, api, slide } = await make();
  const original = api.query(slide), frames = [];
  assert.equal(original[2].parentId, original[1].id, '同 idx 不同作者的回复身份');
  editor.subscribeRecovery((frame) => frames.push(frame));
  api.update(slide, original[0].id, { text: '  修改 <script> & 正文\n  ' });
  const id = api.add(slide, { id: 'test:new', author: '新增作者', initials: 'N', text: '新增正文', x: 55, y: 66 });
  api.reply(slide, id, { id: 'test:reply', author: '回复作者', text: '回复正文', x: 55, y: 66 });
  assert.throws(() => api.update(slide, id, { parentId: 'test:reply' }), /成环/);
  api.remove(slide, original[1].id);
  assert.equal(api.query(slide).length, 4);
  assert.equal(api.query(slide).find((c) => c.text === '已有回复').parentId, undefined, '删除父评论保留回复');
  editor.undo(); assert.equal(api.query(slide).length, 5); editor.redo();
  const restored = await make({ recoveryFrames: frames });
  assert.deepEqual(restored.api.query(restored.slide), api.query(slide), '恢复所有批注字段');
  restored.p.dispose(); restored.editor.dispose();
  if (generated) p.dispose();
  const bytes = await editor.save();
  writeFileSync(join(out, generated ? 'generated.pptx' : 'patched.pptx'), bytes);
  const reopen = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
  const saved = reopen.slides[0].comments;
  assert.equal(saved.length, 4);
  assert.equal(saved.find((c) => c.text.startsWith('  修改')).text, '  修改 <script> & 正文\n  ', '保留正文空白与转义');
  assert.equal(saved.find((c) => c.text === '回复正文').parentId, saved.find((c) => c.text === '新增正文').id);
  if (!generated) {
    const parts = unzipSync(bytes);
    assert(Object.entries(parts).some(([part, value]) => part.startsWith('ppt/comments/web-ppt-edit-') && strFromU8(value).includes('comments-fixture')), '编辑原批注保留未知扩展');
    const second = await editor.save();
    assert.deepEqual(second, bytes, '重复保存字节稳定');
    while (editor.history.undoCount) editor.undo();
    const undone = await core.parse(await editor.save(), { lazy: false });
    assert.deepEqual(undone.slides[0].comments, original, '保存后撤销恢复来源'); undone.dispose();
  }
  reopen.dispose(); p.dispose(); editor.dispose();
}
{
  const left = await make(), right = await make(), framesL = [], framesR = [];
  left.editor.subscribeRecovery((frame) => framesL.push(frame)); right.editor.subscribeRecovery((frame) => framesR.push(frame));
  const id = left.api.query(left.slide)[0].id;
  left.api.update(left.slide, id, { text: '左侧修改' }); right.api.update(right.slide, id, { x: 456 });
  left.editor.applyExternalPatches(framesR[0].patches); right.editor.applyExternalPatches(framesL[0].patches);
  assert.deepEqual(left.api.query(left.slide), right.api.query(right.slide), '跨端独立字段合并');
  assert.equal(left.api.query(left.slide)[0].x, 456);
  assert.throws(() => left.api.update(left.slide, id, { text: '\u0000' }), /XML/);
  left.editor.exec({ type: 'DuplicateSlide', id: left.slide });
  const result = await core.parse(await left.editor.save(), { lazy: false });
  assert.equal(result.slides[1].comments[2].parentId, result.slides[1].comments[1].id, '复制带编辑的批注保留线程');
  result.dispose(); left.p.dispose(); left.editor.dispose(); right.p.dispose(); right.editor.dispose();
}
{
  const { p, editor, api, slide } = await make();
  editor.exec({ type: 'DuplicateSlide', id: slide });
  const result = await core.parse(await editor.save(), { lazy: false });
  assert.equal(result.slides[1].comments[2].parentId, result.slides[1].comments[1].id, '原样复制批注保留线程');
  result.dispose(); p.dispose(); editor.dispose();
}
{
  const p = await core.parse(readFileSync(join(root, 'fixtures/sample-editor-resize.pptx')), { edit: true, keepPackage: true, lazy: false });
  const editor = new edit.Editor(edit.createDoc(p)), api = comments.createCommentEditor(editor), slide = editor.doc.slideOrder[0];
  api.add(slide, { id: 'first', author: '首位作者', text: '首次批注', x: 1, y: 2 });
  const first = await editor.save(), reopened = await core.parse(first, { lazy: false });
  assert.equal(reopened.slides[0].comments[0].text, '首次批注');
  assert.deepEqual(await editor.save(), first, '无来源作者表重复保存稳定');
  editor.undo(); const undone = await core.parse(await editor.save(), { lazy: false });
  assert.equal(undone.slides[0].comments?.length ?? 0, 0, '撤销首次批注清理部件');
  reopened.dispose(); undone.dispose(); p.dispose(); editor.dispose();
}
record();
console.log('批注编辑：增改删、回复身份、历史、恢复、重复保存和两条保存通过');
