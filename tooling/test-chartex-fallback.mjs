import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { runAlternateContentContract, runAlternateContentSaveContract } from './lib/alternate-content-contract.mjs';
import { rewriteCompatibilityFixture, runCompatibilitySelectionContract } from './lib/alternate-content-selection-contract.mjs';
import { runCompatibilityLockContract, runCompatibilityMissingSourceContract, runCompatibilityOpaqueIdentityContract, runCompatibilityRecoveryContract, runCompatibilityStructureContract, runNestedCompatibilityContract } from './lib/alternate-content-structure-contract.mjs';
import { recordCount } from './lib/measured.mjs';
import { runInsertionIdentityValidationContract } from './lib/alternate-content-structure-contract.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out/chartex-fallback');
mkdirSync(out, { recursive: true });
const core = await bundleBrowser({ root, entry: join(root, 'packages/core/src/index.ts'), output: join(out, 'core.mjs') });
const edit = await bundleBrowser({ root, entry: join(root, 'packages/edit-core/src/index.ts'), output: join(out, 'edit.mjs'),
  aliases: [
    ['@web-ppt/core/geometry/handles', join(root, 'packages/core/src/geometry/handles/index.ts')],
    ['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
    ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
  ],
});
const failures = [];
let passed = 0;
const check = (name, ok) => { if (ok) passed++; else failures.push(name); };
const eq = (name, actual, expected) => check(`${name}：预期 ${expected}，实际 ${actual}`, Object.is(actual, expected));
await runAlternateContentContract({ core, bytes: readFileSync(join(root, 'fixtures/sample-chartex-fallback.pptx')), check, eq });
await runAlternateContentSaveContract({ core, edit, bytes: readFileSync(join(root, 'fixtures/sample-chartex-fallback.pptx')), check, eq });
const bytes = readFileSync(join(root, 'fixtures/sample-chartex-fallback.pptx'));
await runCompatibilitySelectionContract({ core, bytes, check, eq });
await runCompatibilityStructureContract({ core, edit, bytes, check, eq });
await runCompatibilityRecoveryContract({ core, edit, bytes, eq });
await runCompatibilityOpaqueIdentityContract({ core, edit, bytes, eq, check });
await runInsertionIdentityValidationContract({ core, edit, bytes: readFileSync(join(root, 'fixtures/sample-editor-space.pptx')), check });
await runNestedCompatibilityContract({ core, edit, bytes, eq });
await runCompatibilityLockContract({ core, edit, bytes, check });
await runCompatibilityMissingSourceContract({ core, edit, bytes, check });
const distinctIds = rewriteCompatibilityFixture(bytes,
  (xml) => xml.replace('<p:cNvPr id="6" name="fallback-chart"/><p:cNvPicPr>', '<p:cNvPr id="9" name="fallback-chart"/><p:cNvPicPr>'));
await runAlternateContentSaveContract({ core, edit, check, eq, bytes: distinctIds });
await runCompatibilityStructureContract({ core, edit, check, eq, bytes: distinctIds });
const media = await core.parse(readFileSync(join(root, 'fixtures/sample-media.pptx')), { lazy: false, edit: true });
try {
  const elements = media.slides[1].elements;
  eq('缺失 InkML 内容采用已有兼容图而非消失', elements.find((element) => element.id === 509)?.kind, 'image');
  check('有效 InkML 仍走原生墨迹', elements.some((element) => element.kind === 'group' && element.name === '墨迹 1'));
} finally { media.dispose?.(); }
if (failures.length) throw new Error(failures.join('\n'));
recordCount('chartexFallback', passed);
console.log(`ChartEx 回退专项通过（${passed} 项）`);
