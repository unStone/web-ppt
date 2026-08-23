/** 用真实办公软件打开补丁保存产物，避免只证明“自己的解析器能读自己的输出”。 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleBrowser } from './lib/bundle-browser.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out/edit-libreoffice');
mkdirSync(out, { recursive: true });

async function generateSavedPath() {
  const core = await bundleBrowser({
    root, entry: join(root, 'packages/core/src/index.ts'), output: join(out, 'core.mjs'),
  });
  const aliases = [
    ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
    ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
  ];
  const edit = await bundleBrowser({
    root, entry: join(root, 'packages/edit-core/src/index.ts'), output: join(out, 'edit.mjs'), aliases,
  });
  const sourceBytes = new Uint8Array(readFileSync(join(root, 'fixtures/sample-edit-xfrm.pptx')));
  const pres = await core.parse(sourceBytes, { edit: true, keepPackage: true, lazy: false, assets: 'defer' });
  const doc = edit.createDoc(pres, { idPrefix: 'libreoffice-' });
  const target = Object.values(doc.elements).find((record) => record.src.name === '异名前缀形状');
  if (!target) throw new Error('LibreOffice 固件缺少 SetXfrm 目标');
  const editor = new edit.Editor(doc);
  editor.exec({
    type: 'SetXfrm', id: target.id, x: target.src.x + 17.25, y: target.src.y + 8.5, rot: 11,
  });
  const saved = await editor.saveDetailed();
  const path = join(out, 'saved.pptx');
  writeFileSync(path, saved.bytes);
  edit.disposeDoc(doc);
  return path;
}

const requested = process.argv[2];
const savedPath = requested
  ? (isAbsolute(requested) ? requested : resolve(root, requested))
  : await generateSavedPath();
if (!existsSync(savedPath)) throw new Error(`找不到待验证的保存产物：${savedPath}`);

const candidates = [
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/bin/soffice',
  '/usr/local/bin/soffice',
];
const soffice = candidates.find((candidate) => existsSync(candidate));
if (!soffice) throw new Error('未找到 LibreOffice；CI 与本地验收必须安装 soffice');

const pdf = join(out, `${basename(savedPath, extname(savedPath))}.pdf`);
if (existsSync(pdf)) unlinkSync(pdf);
const opened = spawnSync(soffice, [
  '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', out, savedPath,
], { cwd: root, encoding: 'utf8', timeout: 300_000 });
if (opened.error) throw opened.error;
if (opened.status !== 0) {
  const termination = opened.signal ? `信号 ${opened.signal}` : `退出码 ${opened.status}`;
  throw new Error(`LibreOffice 打开失败（${termination}）：${opened.stderr || opened.stdout}`);
}
const diagnostics = `${opened.stdout}\n${opened.stderr}`;
if (/\b(repair(?:ed)?|recover(?:ed|y)?|corrupt(?:ed)?|damaged)\b/i.test(diagnostics)) {
  throw new Error(`LibreOffice 报告修复或恢复：${diagnostics.trim()}`);
}
if (!existsSync(pdf) || statSync(pdf).size === 0) throw new Error('LibreOffice 未生成有效 PDF');

console.log(`\n\x1b[32m✓ LibreOffice 已打开 ${basename(savedPath)} 并导出 PDF（${statSync(pdf).size} bytes）\x1b[0m`);
