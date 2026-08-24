/** 对保存测试声明的全部产物逐一运行真实 LibreOffice 门禁。 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDIT_SAVE_OFFICE_ARTIFACTS } from './lib/edit-save-office-artifacts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const artifact of EDIT_SAVE_OFFICE_ARTIFACTS) {
  execFileSync(process.execPath, [
    join(root, 'tooling/test-edit-libreoffice.mjs'),
    join(root, 'out/edit-save', artifact.file),
    String(artifact.slides),
  ], { cwd: root, stdio: 'inherit' });
}
