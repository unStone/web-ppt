/** 生成可交给真实办公软件检查的产物；这里的重开只证明公开 API，不冒充 Office 验收。 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { bundleBrowser } from './lib/bundle-browser.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out/chartex-generated');
mkdirSync(out, { recursive: true });
const source = resolve(root, process.argv[2] ?? 'fixtures/sample-chartex-fallback.pptx');
const bytes = readFileSync(source);
const core = await bundleBrowser({ root, entry: join(root, 'packages/core/src/index.ts'), output: join(out, 'core.mjs') });
const edit = await bundleBrowser({ root, entry: join(root, 'packages/edit-core/src/index.ts'), output: join(out, 'edit.mjs'),
  aliases: [
    ['@web-ppt/core/geometry/handles', join(root, 'packages/core/src/geometry/handles/index.ts')],
    ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
    ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
  ],
});
const presentation = await core.parse(bytes, { edit: true, keepPackage: true, lazy: true });
const editor = new edit.Editor(edit.createDoc(presentation, { idPrefix: 'mc-generated-probe-' }));
try {
  const frame = Object.values(editor.doc.elements).find((record) => record.src.editInfo?.requiresOriginal);
  if (!frame) throw new Error('探针输入不含兼容框架对象');
  const moveApplied = !frame.meta.moveLocked;
  if (moveApplied) editor.exec({ type: 'SetXfrm', id: frame.id, x: frame.src.x + 10 });
  presentation.dispose();
  const result = await editor.save();
  const output = join(out, `${basename(source, '.pptx')}-generated.pptx`);
  const reopened = await core.parse(result, { edit: true, lazy: false });
  try {
    const frames = reopened.slides.flatMap((slide) => slide.elements).filter((el) => el.editInfo?.requiresOriginal);
    if (!frames.length) throw new Error('生成包重开丢失兼容对象');
    writeFileSync(output, result);
    const report = { source, sourceHash: createHash('sha256').update(bytes).digest('hex'), output,
      outputHash: createHash('sha256').update(result).digest('hex'), slides: reopened.slides.length,
      originalDisposed: presentation.package.disposed, moveApplied, frameCount: frames.length, officeVerified: false };
    writeFileSync(`${output}.json`, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally { reopened.dispose(); }
} finally { editor.dispose(); }
