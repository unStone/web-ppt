/** 用真实办公软件打开补丁保存产物，避免只证明“自己的解析器能读自己的输出”。 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out/edit-libreoffice');
mkdirSync(out, { recursive: true });

const bundle = async (entry, output) => {
  execFileSync('npx', [
    'esbuild', entry, '--bundle', '--format=esm', '--platform=browser', '--log-level=error',
    `--outfile=${output}`,
  ], { cwd: root, stdio: 'inherit' });
  return import(`${pathToFileURL(output).href}?run=${Date.now()}`);
};

const core = await bundle(join(root, 'packages/core/src/index.ts'), join(out, 'core.mjs'));
const opc = await bundle(join(root, 'packages/edit-core/src/opc/index.ts'), join(out, 'opc.mjs'));
const sourceBytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-zip-passthrough.pptx')));
const pres = await core.parse(sourceBytes, { keepPackage: true, lazy: false });
const target = 'ppt/slides/slide1.xml';
const changed = new TextEncoder().encode(
  `${new TextDecoder().decode(pres.package.parts[target])}<!--libreoffice-open-->`,
);
const saved = opc.patchOpcPackage(pres.package, { [target]: changed });
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

opc.disposeOpcPackage(saved.package);
pres.dispose?.();
console.log(`\n\x1b[32m✓ LibreOffice 已打开补丁保存产物并导出 PDF（${statSync(pdf).size} bytes）\x1b[0m`);
