import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '../..');
const dist = process.argv.includes('--dist');
const { core, edit, describe } = dist ? {
  core: await import('@web-ppt/core'), edit: await import('@web-ppt/edit-core'),
  describe: await import('@web-ppt/edit-core/describe'),
} : await import(pathToFileURL(join(root, 'out/agent-describe/contract.mjs')));
const output = {};
for (const file of readdirSync(join(root, 'fixtures')).filter((name) => /\.(pptx|ppt)$/i.test(name)).sort()) {
  const pres = await core.parse(readFileSync(join(root, 'fixtures', file)), {
    edit: true, keepPackage: true, lazy: false,
    ...(file.includes('encrypted') ? { password: 'web-ppt-2024' } : {}),
  });
  const editor = new edit.Editor(edit.createDoc(pres, { idPrefix: 'agent-' }));
  const result = describe.describePresentation(editor.doc);
  for (const slide of result.slides) for (const element of slide.elements) {
    editor.select({ kind: 'elements', ids: [element.id], enteredGroup: null });
    assert.deepEqual(editor.selection.ids, [element.id], `${file} 页 ${slide.number} 元素 ${element.id} 可选中`);
  }
  output[file] = result;
  pres.dispose(); editor.dispose();
}
process.stdout.write(JSON.stringify(output));
