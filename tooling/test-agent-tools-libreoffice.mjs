import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'out/agent-tools');
execFileSync(process.execPath, [join(root, 'tooling/test-agent-tools.mjs'), '--dist'], { cwd: root, stdio: 'inherit' });
const evidence = { libreOffice: execFileSync('soffice', ['--version'], { encoding: 'utf8' }).trim(), artifacts: {} };
for (const name of ['patch', 'generated']) {
  const file = join(out, `${name}.pptx`);
  execFileSync(process.execPath, [join(root, 'tooling/test-edit-libreoffice.mjs'), file, '2'], { cwd: root, stdio: 'inherit' });
  evidence.artifacts[name] = { libreOfficeOpened: true, quickLook: 'not-run' };
}
if (process.platform === 'darwin') {
  const quickLook = join(out, 'quicklook');
  mkdirSync(quickLook, { recursive: true });
  for (const name of ['patch', 'generated']) {
    const file = join(out, `${name}.pptx`);
    execFileSync('qlmanage', ['-t', '-s', '512', '-o', quickLook, file], { cwd: root, stdio: 'pipe', timeout: 60_000 });
    const thumbnail = join(quickLook, `${name}.pptx.png`);
    assert(existsSync(thumbnail) && statSync(thumbnail).size > 0, `${name} 必须由 Quick Look 实际读出缩略图`);
    evidence.artifacts[name].quickLook = thumbnail;
  }
}
writeFileSync(join(out, 'external-readers.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log('Agent 工具补丁 / 生成保存：LibreOffice 与独立读取器打开通过（Quick Look 仅在 macOS 执行）');
