/** 对模型保存和官网真实下载声明的全部产物逐一运行 LibreOffice 门禁。 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_OFFICE_ARTIFACTS } from './lib/edit-save-office-artifacts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const artifact of ALL_OFFICE_ARTIFACTS) {
  execFileSync(process.execPath, [
    join(root, 'tooling/test-edit-libreoffice.mjs'),
    join(root, artifact.path),
    String(artifact.libreOfficePages ?? artifact.slides),
  ], { cwd: root, stdio: 'inherit' });
}
