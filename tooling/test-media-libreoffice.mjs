import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const prefix of ['', 'mp4-', 'fmp4-']) for (const mode of ['patched', 'generated']) {
  execFileSync(process.execPath, [join(root, 'tooling/test-edit-libreoffice.mjs'),
    join(root, `out/media-insertion/${prefix}${mode}.pptx`), '1'], { cwd: root, stdio: 'inherit' });
}
