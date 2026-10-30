/**
 * OLE 嵌入文档改写的外部读取器验证（票据 014 / 015 的 LibreOffice 项）。
 *
 *   node tooling/test-ole-edit-libreoffice.mjs
 *
 * SDK 改写嵌入 DOCX 的 run 文字与 XLSX 的样式 / 富文本并保存后，把嵌入文档
 * 重组为独立 .docx / .xlsx，交给 LibreOffice 打开转换：DOCX 提取纯文本断言改写
 * 的 run 文字在场；XLSX 转 CSV 断言富文本拼接值，再转回 XLSX 用 SDK 读回，
 * 断言字体颜色与填充在办公软件的解析往返后仍然在场。
 */
import { countedAssert } from './lib/counted-assert.mjs';
const { assert, record } = countedAssert('oleLibreOffice');
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync, zipSync } from 'fflate';
import { bundleBrowser } from './lib/bundle-browser.mjs';

const root = resolve(import.meta.dirname, '..'), out = join(root, 'out/ole-edit/libreoffice');
mkdirSync(out, { recursive: true });
const entry = join(root, 'out/ole-edit/entry.mjs');
writeFileSync(entry, `export * as core from ${JSON.stringify(join(root, 'packages/core/src/index.ts'))};
export * as edit from ${JSON.stringify(join(root, 'packages/edit-core/src/index.ts'))};
export * as ole from ${JSON.stringify(join(root, 'packages/edit-core/src/ole/index.ts'))};`);
const { core, edit, ole } = process.argv.includes('--dist') ? Object.fromEntries(await Promise.all([
  ['core', 'core/dist/core.js'], ['edit', 'edit-core/dist/edit-core.js'], ['ole', 'edit-core/dist/ole.js'],
].map(async ([key, file]) => [key, await import(pathToFileURL(join(root, 'packages', file)))])))
  : await bundleBrowser({ root, entry, output: join(root, 'out/ole-edit/contract.mjs'), aliases: [
    ['@web-ppt/edit-core/cfb', join(root, 'packages/edit-core/src/cfb/index.ts')],
    ['@web-ppt/edit-core/xml', join(root, 'packages/edit-core/src/xml/index.ts')],
    ['@web-ppt/edit-core/opc', join(root, 'packages/edit-core/src/opc/index.ts')],
    ['@web-ppt/edit-core', join(root, 'packages/edit-core/src/index.ts')],
    ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
    ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
  ] });

const SOFFICE_CANDIDATES = [
  '/Applications/LibreOffice.app/Contents/MacOS/soffice', '/usr/bin/soffice', '/usr/local/bin/soffice', 'soffice',
];
const soffice = SOFFICE_CANDIDATES.find((p) => p === 'soffice' || existsSync(p));
if (!soffice) throw new Error('未找到 LibreOffice；macOS: brew install --cask libreoffice');

// ---------------- SDK 编辑并保存 ----------------
const RUN_TEXT = 'LibreOffice 对照改写';
const RICH_FIRST = '外部读取器', RICH_SECOND = '往返验证';
const FONT_COLOR = 'FF0000', FILL_COLOR = 'E2EFDA';
const input = readFileSync(join(root, 'fixtures/sample-ole-edit.pptx'));
const pres = await core.parse(input, { edit: true, keepPackage: true, lazy: false });
const editor = new edit.Editor(edit.createDoc(pres, { idPrefix: 'ole-lo-' }));
const api = ole.createOleEditor(editor);
for (const item of ole.listEditableOle(editor.doc)) {
  const content = api.query(item.id);
  if (content.kind === 'docx') {
    // run 级改字：取第一个多 run 段落的最后一个 run，只改它的文字
    const paragraph = content.paragraphs.find((p) => p.editable && p.runs.length > 1);
    assert.ok(paragraph, '固件提供多 run 段落');
    api.setRun(item.id, paragraph.index, paragraph.runs.length - 1, RUN_TEXT);
  } else {
    api.setCellStyle(item.id, content.sheets[0].id, 'B2', { font: { bold: true, color: FONT_COLOR, size: 14 }, fill: { color: FILL_COLOR } });
    api.setCellRichText(item.id, content.sheets[0].id, 'E2', [{ text: RICH_FIRST, bold: true }, { text: RICH_SECOND, italic: true }]);
  }
}
const savedBytes = await editor.save();
writeFileSync(join(out, 'edited.pptx'), Buffer.from(savedBytes));

// ---------------- 重组改写后的嵌入文档 ----------------
// [Content_Types].xml 排首 + 默认压缩：CI 的旧版 LibreOffice 对 store 模式或
// 乱序条目的 OOXML 包会报 source file could not be loaded。
function rezip(parts) {
  const ordered = { '[Content_Types].xml': parts['[Content_Types].xml'] };
  for (const key of Object.keys(parts).sort()) if (key !== '[Content_Types].xml') ordered[key] = parts[key];
  return zipSync(ordered, { level: 6 });
}
const documents = [];
for (const item of ole.listEditableOle(editor.doc)) {
  const pkg = ole.readEmbeddedPackage(api.exportContent(item.id));
  assert.ok(pkg, `嵌入对象 ${item.id} 可解出原生文档`);
  const file = join(out, `embedded-${item.id}.${pkg.kind}`);
  writeFileSync(file, rezip(pkg.parts));
  documents.push({ kind: pkg.kind, file });
}
assert.ok(documents.some((d) => d.kind === 'docx') && documents.some((d) => d.kind === 'xlsx'), '两类嵌入文档都重组成功');

/** soffice 转换并等待产物；独立 profile 避免与本机 GUI 实例的锁冲突，显式 filter 名兼容旧版。 */
function convert(file, format, outdir = out) {
  execFileSync(soffice, ['-env:UserInstallation=file:///tmp/ole-lo-verify', '--headless', '--norestore',
    '--convert-to', format, '--outdir', outdir, file], { timeout: 120_000 });
  const stem = file.split('/').pop().replace(/\.[^.]+$/, '');
  const suffix = `.${format.split(':')[0]}`;
  const produced = readdirSync(outdir).map((f) => join(outdir, f)).find((f) => f.split('/').pop().startsWith(stem) && f.endsWith(suffix) && f !== file);
  if (!produced) throw new Error(`LibreOffice 未产出 ${format}：${file}`);
  return produced;
}

// ---------------- DOCX：LibreOffice 转 Flat XML，改写的 run 文字在场 ----------------
{
  const docx = documents.find((d) => d.kind === 'docx');
  // 本机 txt filter 存在 Io Abort 问题，fodt（Flat XML）同样承载全文且可断言
  const flat = readFileSync(convert(docx.file, 'fodt:OpenDocument Text Flat XML'), 'utf8');
  assert.ok(flat.includes(RUN_TEXT), 'DOCX 经 LibreOffice 打开后改写的 run 文字在场');
}

// ---------------- XLSX：Flat XML 断言富文本拼接值；转回 XLSX 后 SDK 读回样式 ----------------
{
  const xlsx = documents.find((d) => d.kind === 'xlsx');
  const flat = readFileSync(convert(xlsx.file, 'fods:OpenDocument Spreadsheet Flat XML'), 'utf8');
  assert.ok(flat.includes(RICH_FIRST) && flat.includes(RICH_SECOND), '工作簿经 LibreOffice 打开后富文本各片段文字在场');

  // 往返：LibreOffice 重写为新的 xlsx 后，样式与富文本语义仍在（unzip 后直接核对
  // styles.xml / sharedStrings.xml——办公软件重写会重排样式索引，按语义而非索引断言）
  const roundTripDir = join(out, 'roundtrip');
  mkdirSync(roundTripDir, { recursive: true });
  const roundTrip = convert(xlsx.file, 'xlsx:Calc MS Excel 2007 XML', roundTripDir);
  const rewritten = unzipSync(new Uint8Array(readFileSync(roundTrip)));
  const styles = new TextDecoder().decode(rewritten['xl/styles.xml'] ?? new Uint8Array());
  assert.ok(styles.includes(FONT_COLOR), 'LibreOffice 重写后字体颜色仍在 styles.xml');
  assert.ok(styles.includes(FILL_COLOR), 'LibreOffice 重写后填充颜色仍在 styles.xml');
  const shared = new TextDecoder().decode(rewritten['xl/sharedStrings.xml'] ?? new Uint8Array());
  assert.ok(shared.includes(RICH_FIRST) && shared.includes(RICH_SECOND), 'LibreOffice 重写后富文本各片段文字仍在 sharedStrings');
  assert.ok(new RegExp(`<t[^>]*>${RICH_FIRST}</t>`).test(shared) && new RegExp(`<t[^>]*>${RICH_SECOND}</t>`).test(shared),
    '富文本按片段分别存储（保留 run 边界）');
}

record();
console.log('OLE 嵌入文档改写经 LibreOffice 打开验证：DOCX run 文字、XLSX 样式与富文本往返在场');
