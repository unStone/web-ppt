import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync } from 'fflate';
import { bundleBrowser } from './lib/bundle-browser.mjs';

const root = process.cwd();
const out = resolve(root, 'out/open-kind');
mkdirSync(out, { recursive: true });
const api = await bundleBrowser({
  root,
  entry: resolve(root, 'packages/site/src/open-kind.ts'),
  output: resolve(out, 'open-kind.mjs'),
});

const { identifyOpenBytes, mapOpenError, OPEN_KIND, OpenKindError, rejectIfNotPresentation } = api;

const zipOffice = (contentType, extra = {}) => zipSync({
  '[Content_Types].xml': new TextEncoder().encode(
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Override PartName="/doc.xml" ContentType="${contentType}"/></Types>`,
  ),
  ...extra,
});

assert.equal(identifyOpenBytes(new Uint8Array()).message, OPEN_KIND.empty);
assert.equal(identifyOpenBytes(new TextEncoder().encode('%PDF-1.4\ntrailer\n%%EOF')).message, OPEN_KIND.pdf);
assert.equal(identifyOpenBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).message, OPEN_KIND.image);
assert.equal(identifyOpenBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])).message, OPEN_KIND.image);
assert.equal(identifyOpenBytes(new TextEncoder().encode('<!doctype html><title>x</title>')).message, OPEN_KIND.html);
assert.equal(identifyOpenBytes(new TextEncoder().encode('invalid')).message, OPEN_KIND.unknown);

const word = zipOffice('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml');
assert.equal(identifyOpenBytes(word).message, OPEN_KIND.word);

const excel = zipOffice('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml');
assert.equal(identifyOpenBytes(excel).message, OPEN_KIND.excel);

const odp = zipSync({
  mimetype: new TextEncoder().encode('application/vnd.oasis.opendocument.presentation'),
});
assert.equal(identifyOpenBytes(odp).message, OPEN_KIND.odp);

const randomZip = zipSync({ 'readme.txt': new TextEncoder().encode('not office') });
assert.equal(identifyOpenBytes(randomZip).message, OPEN_KIND.zip);

const namedPdf = new File([new TextEncoder().encode('%PDF-1.4\n%%EOF')], 'slides.pptx');
assert.equal(identifyOpenBytes(await namedPdf.arrayBuffer()).message, OPEN_KIND.pdf, '扩展名不能盖过魔数');

const showcase = readFileSync(resolve(root, 'fixtures/showcase.pptx'));
assert.equal(identifyOpenBytes(showcase).kind, 'presentation');

const encryptedHead = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
assert.equal(identifyOpenBytes(encryptedHead).kind, 'presentation', 'CFB 必须放行给密码/解析');

assert.equal(mapOpenError(new Error('无法识别的文件格式：既不是 .pptx（Zip）也不是 .ppt（CFB）')), OPEN_KIND.unknown);
assert.equal(mapOpenError(new Error('无效的 .pptx：找不到 ppt/presentation.xml')), OPEN_KIND.zip);
assert.equal(mapOpenError(new Error('无效的 .ppt：找不到 PowerPoint Document 流')), OPEN_KIND.ole);
assert.equal(mapOpenError(new Error('密码错误')), null);

const pdfReject = new TextEncoder().encode('%PDF-1.4\n%%EOF');
assert.throws(() => rejectIfNotPresentation(pdfReject), (error) => (
  error instanceof OpenKindError && error.openMessage === OPEN_KIND.pdf
), 'PDF 必须在认文件处拒绝');
assert.doesNotThrow(() => rejectIfNotPresentation(showcase), '真演示文稿不能被认文件拒绝');

console.log('打开前认文件通过');
