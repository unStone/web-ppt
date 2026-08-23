/** 用真实办公软件打开补丁保存产物，避免只证明“自己的解析器能读自己的输出”。 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out/edit-libreoffice');
mkdirSync(out, { recursive: true });

const bundle = async (entry, output, aliases = []) => {
  execFileSync('npx', [
    'esbuild', entry, '--bundle', '--format=esm', '--platform=browser', '--log-level=error',
    ...aliases.map(([from, to]) => `--alias:${from}=${to}`),
    `--outfile=${output}`,
  ], { cwd: root, stdio: 'inherit' });
  return import(`${pathToFileURL(output).href}?run=${Date.now()}`);
};

const core = await bundle(join(root, 'packages/core/src/index.ts'), join(out, 'core.mjs'));
const aliases = [
  ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
  ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
];
const edit = await bundle(join(root, 'packages/edit-core/src/index.ts'), join(out, 'edit.mjs'), aliases);
const save = await bundle(join(root, 'packages/edit-core/src/save/index.ts'), join(out, 'save.mjs'), aliases);
const sourceBytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-edit-xfrm.pptx')));
const pres = await core.parse(sourceBytes, { edit: true, keepPackage: true, lazy: false, assets: 'defer' });
const doc = edit.createDoc(pres, { idPrefix: 'libreoffice-' });
const target = Object.values(doc.elements).find((record) => record.src.name === '异名前缀形状');
if (!target) throw new Error('LibreOffice 固件缺少 SetXfrm 目标');
new edit.Editor(doc).exec({
  type: 'SetXfrm', id: target.id, x: target.src.x + 17.25, y: target.src.y + 8.5, rot: 11,
});
const saved = save.saveEditDoc(doc);
const savedPath = join(out, 'saved.pptx');
writeFileSync(savedPath, saved.bytes);

const candidates = [
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/bin/soffice',
  '/usr/local/bin/soffice',
];
const soffice = candidates.find((candidate) => existsSync(candidate));
if (!soffice) throw new Error('未找到 LibreOffice；CI 与本地验收必须安装 soffice');

const pdf = join(out, 'saved.pdf');
if (existsSync(pdf)) unlinkSync(pdf);
execFileSync(soffice, [
  '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', out, savedPath,
], { cwd: root, stdio: 'inherit', timeout: 300_000 });
if (!existsSync(pdf) || statSync(pdf).size === 0) throw new Error('LibreOffice 未生成有效 PDF');

edit.disposeDoc(doc);
console.log(`\n\x1b[32m✓ LibreOffice 已打开 SetXfrm 写回产物并导出 PDF（${statSync(pdf).size} bytes）\x1b[0m`);
