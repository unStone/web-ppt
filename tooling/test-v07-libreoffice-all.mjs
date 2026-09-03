import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  V07_OFFICE_ARTIFACTS, V07_OFFICE_MANIFEST,
} from './lib/v07-office-artifacts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out/v07-integration');
const manifest = JSON.parse(readFileSync(join(out, V07_OFFICE_MANIFEST), 'utf8'));
if (manifest.version !== 1
  || JSON.stringify(manifest.artifacts) !== JSON.stringify(V07_OFFICE_ARTIFACTS)) {
  throw new Error('0.7 LibreOffice 门禁必须消费本轮生成的完整清单');
}
for (const artifact of manifest.artifacts) {
  execFileSync(process.execPath, [
    join(root, 'tooling/test-edit-libreoffice.mjs'),
    join(out, artifact.file),
    String(artifact.libreOfficePages ?? artifact.slides),
  ], { cwd: root, stdio: 'inherit' });
}
