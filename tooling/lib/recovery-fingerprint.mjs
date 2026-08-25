import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [fixture, framesFile, prefix] = process.argv.slice(2);
if (!fixture || !framesFile || !prefix) throw new Error('恢复指纹缺少 fixture、frames 或 prefix');
const root = process.cwd();
const core = await import(`${pathToFileURL(join(root, 'out/edit/core.mjs')).href}?run=${Date.now()}`);
const edit = await import(`${pathToFileURL(join(root, 'out/edit/edit-core.mjs')).href}?run=${Date.now()}`);
const bytes = new Uint8Array(readFileSync(fixture));
const frames = JSON.parse(readFileSync(framesFile, 'utf8'));
const presentation = await core.parse(bytes, {
  edit: true, keepPackage: true, lazy: false, assets: 'defer',
});
const doc = edit.createDoc(presentation, { idPrefix: prefix });
const editor = new edit.Editor(doc, { recoveryFrames: frames });
const hash = createHash('sha256');
for (const textMode of ['html', 'svg']) for (const [index, id] of doc.slideOrder.entries()) {
  hash.update(`${textMode}\0${id}\0`);
  hash.update(core.renderSlideToSvg(
    presentation, editor.toSlide(id), { textMode, idPrefix: `recovery-${textMode}-${index}-` },
  ));
}
process.stdout.write(JSON.stringify({ pages: doc.slideOrder.length, digest: hash.digest('hex') }));
edit.disposeDoc(doc);
