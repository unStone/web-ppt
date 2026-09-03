/** 默认验证 M1 模型产物；CI 显式加 --include-site 后验证含官网真实下载的完整清单。 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_OFFICE_ARTIFACTS, EDIT_SAVE_OFFICE_ARTIFACTS,
} from './lib/edit-save-office-artifacts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const includeSite = process.argv.slice(2).includes('--include-site');
const unknown = process.argv.slice(2).filter((argument) => argument !== '--include-site');
if (unknown.length) throw new Error(`未知参数：${unknown.join(' ')}`);
const artifacts = includeSite ? ALL_OFFICE_ARTIFACTS : EDIT_SAVE_OFFICE_ARTIFACTS.map((artifact) => ({
  ...artifact, path: `out/edit-save/${artifact.file}`,
}));
for (const artifact of artifacts) {
  execFileSync(process.execPath, [
    join(root, 'tooling/test-edit-libreoffice.mjs'),
    join(root, artifact.path),
    String(artifact.libreOfficePages ?? artifact.slides),
  ], { cwd: root, stdio: 'inherit' });
}
