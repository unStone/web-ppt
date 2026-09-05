import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mediaArtifacts } from './lib/media-artifacts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const { name, pages } of mediaArtifacts) {
  execFileSync(process.execPath, [join(root, 'tooling/test-edit-libreoffice.mjs'),
    join(root, `out/media-insertion/${name}.pptx`), String(pages)], { cwd: root, stdio: 'inherit' });
}
