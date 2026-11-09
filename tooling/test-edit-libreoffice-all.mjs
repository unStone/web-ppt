/** 默认验证模型产物；官网可独立验证，也可用 --include-site 验证完整清单。 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectEditOfficeArtifacts } from './lib/edit-office-selection.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = selectEditOfficeArtifacts(process.argv.slice(2));
for (const artifact of artifacts) {
  execFileSync(process.execPath, [
    join(root, 'tooling/test-edit-libreoffice.mjs'),
    join(root, artifact.path),
    String(artifact.libreOfficePages ?? artifact.slides),
  ], { cwd: root, stdio: 'inherit' });
}
