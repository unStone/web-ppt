import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'out/template-fill');
const source = process.argv.includes('--source');
const browser = process.argv.includes('--browser');
const suffix = source ? '' : '-dist';
execFileSync(process.execPath, [join(root, browser ? 'tooling/test-template-fill-browser.mjs' : 'tooling/test-template-fill.mjs'),
  ...(source ? [] : ['--dist'])], { cwd: root, stdio: 'inherit' });
const artifacts = browser ? ['fixture', 'editorial', 'aurora', 'midnight'].map(name => `browser-${name}${suffix}`)
  : ['fixture-filled', 'editorial-filled', 'aurora-filled', 'midnight-filled'];
if (process.env.TEMPLATE_FILL_EXTERNAL) artifacts.push(browser ? `browser-external${suffix}` : 'external-filled');
const evidence = { libreOffice: execFileSync('soffice', ['--version'], { encoding: 'utf8' }).trim(), artifacts: {} };
evidence.scope = '验证无修复打开、页数及实际缩略图；不声明跨读取器像素一致';
evidence.limitations = [{ reason: 'quicklook-dynamic-field-inheritance',
  detail: 'Quick Look 对 Midnight 动态页码的主题文字色继承存在预览差异；独立 LibreOffice PDF 为白色页码，动态字段和继承链仍保留',
  evidence: 'out/template-fill/midnight-field-readers.json' }];
const thumbnails = join(out, 'quicklook');
const snapshots = join(out, `office-${source ? 'source' : 'dist'}${browser ? '-browser' : ''}-inputs`);
mkdirSync(snapshots, { recursive: true });
// 生成测试会反复重写产物；独立读取器必须持有本轮冻结字节，不能与下一次生成并发读写。
for (const name of artifacts) writeFileSync(join(snapshots, `${name}.pptx`), readFileSync(join(out, `${name}.pptx`)));
if (process.platform === 'darwin') mkdirSync(thumbnails, { recursive: true });
for (const name of artifacts) {
  const file = join(snapshots, `${name}.pptx`);
  execFileSync(process.execPath, [join(root, 'tooling/test-edit-libreoffice.mjs'), file, '6'],
    { cwd: root, stdio: 'inherit' });
  evidence.artifacts[name] = { pages: 6, libreOfficeOpened: true, quickLook: 'not-run-non-macos' };
  if (process.platform === 'darwin') {
    execFileSync('qlmanage', ['-t', '-s', '512', '-o', thumbnails, file], { cwd: root, stdio: 'pipe', timeout: 60_000 });
    const thumbnail = join(thumbnails, `${name}.pptx.png`);
    assert(existsSync(thumbnail) && statSync(thumbnail).size > 0, `${name} 必须由 Quick Look 实际读取缩略图`);
    evidence.artifacts[name].quickLook = thumbnail;
  }
}
writeFileSync(join(out, 'external-readers.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log('模板填充的四份自有/内置模板产物及指定外部产物通过独立读取器验证');
