import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { collectApiContract, assertApiContract, checkApiArtifacts } from './lib/api-contract-model.mjs';

const root = join(import.meta.dirname, '..');
const work = join(root, 'out/api-contract');
mkdirSync(work, { recursive: true });
const project = mkdtempSync(join(work, 'test-'));
const save = (path, value) => {
  const target = join(project, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
};
const manifest = {
  name: '@contract/public', version: '0.1.0', type: 'module', files: ['dist', 'schemas', 'skills'],
  exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' },
    './schema.json': './schemas/report.json', './package.json': './package.json' },
  bin: { 'contract-cli': './dist/cli.js' },
};
const protocol = { specifier: '@contract/public', symbol: 'Journal', property: 'version' };
const schema = { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object',
  properties: { version: { const: 1 } }, required: ['version'], additionalProperties: false };
save('package.json', { name: 'api-contract-tests', private: true, workspaces: ['packages/*'] });
save('tsconfig.json', { compilerOptions: { target: 'ES2020', module: 'ESNext', moduleResolution: 'bundler',
  paths: { '@contract/public': ['./packages/public/src/index.ts'] }, skipLibCheck: true } });
save('packages/public/package.json', manifest);
save('packages/public/src/index.ts', 'export { Journal } from "./journal";\n');
save('packages/public/src/journal.ts', 'export interface Journal { readonly version: 1; readonly value: string }\n');
save('packages/public/dist/index.d.ts', 'export { Journal } from "./journal";\n');
save('packages/public/dist/journal.d.ts', 'export interface Journal { readonly version: 1; readonly value: string }\n');
save('packages/public/dist/index.js', 'export const ready = true;\n');
save('packages/public/dist/cli.js', '#!/usr/bin/env node\nexport const cli = true;\n');
save('packages/public/schemas/report.json', schema);
save('packages/public/skills/contract/SKILL.md', '# Contract\nUse the CLI.\n');
save('packages/private/package.json', { name: '@contract/private', private: true });

const options = { protocols: [protocol] };
const baseline = await collectApiContract(project, options);
assert.equal(baseline.phase, 'candidate');
assert.deepEqual(baseline.packages.map(({ name }) => name), ['@contract/public']);
assert.equal(baseline.protocols[0].version, 1);
assert.equal(baseline.protocols[0].source, 'packages/public/src/journal.ts');
assert.equal(baseline.schemas.length, 1);
assert.equal(baseline.resources.length, 1);
assertApiContract(baseline, await collectApiContract(project, options));
await checkApiArtifacts(project, baseline, options);

// 包版本与 JSON 键排版不属于协议语义；条件匹配顺序属于 Node 的解析语义。
save('packages/public/package.json', { ...manifest, version: '0.2.0' });
save('packages/public/schemas/report.json', { additionalProperties: false, required: ['version'],
  properties: { version: { const: 1 } }, type: 'object', $schema: schema.$schema });
assertApiContract(baseline, await collectApiContract(project, options));
save('packages/public/package.json', { ...manifest, exports: { ...manifest.exports,
  '.': { import: './dist/index.js', types: './dist/index.d.ts' } } });
await assert.rejects(async () => assertApiContract(baseline, await collectApiContract(project, options)), /API 候选清单漂移/);

save('packages/public/package.json', { ...manifest, exports: { ...manifest.exports, './new': './dist/new.js' } });
await assert.rejects(async () => assertApiContract(baseline, await collectApiContract(project, options)), /API 候选清单漂移/);
save('packages/public/package.json', manifest);
save('packages/extra/package.json', { name: '@contract/extra', version: '1.0.0', exports: { '.': './index.js' } });
await assert.rejects(async () => assertApiContract(baseline, await collectApiContract(project, options)), /API 候选清单漂移/);
rmSync(join(project, 'packages/extra'), { recursive: true });

save('packages/public/schemas/report.json', { ...schema, additionalProperties: true });
await assert.rejects(async () => assertApiContract(baseline, await collectApiContract(project, options)), /API 候选清单漂移/);
await assert.rejects(() => checkApiArtifacts(project, baseline, options), /发布 Schema 与候选内容不一致/);
save('packages/public/schemas/report.json', schema);
save('packages/public/src/journal.ts', 'export interface Journal { readonly version: 2; readonly value: string }\n');
await assert.rejects(async () => assertApiContract(baseline, await collectApiContract(project, options)), /API 候选清单漂移/);
save('packages/public/src/journal.ts', 'export interface Journal { readonly version: number; readonly value: string }\n');
await assert.rejects(() => collectApiContract(project, options), /Journal.version.*正整数字面量/);
save('packages/public/src/journal.ts', 'export interface Journal { readonly version: 1; readonly value: string }\n');
save('packages/public/skills/contract/SKILL.md', '# Contract\nChanged contract.\n');
await assert.rejects(async () => assertApiContract(baseline, await collectApiContract(project, options)), /API 候选清单漂移/);
save('packages/public/skills/contract/SKILL.md', '# Contract\nUse the CLI.\n');

save('packages/public/dist/journal.d.ts', 'export interface Journal { readonly version: 2; readonly value: string }\n');
await assert.rejects(() => checkApiArtifacts(project, baseline, options), /发布协议.*Journal.version.*2.*1/);
save('packages/public/dist/journal.d.ts', 'export interface Journal { readonly version: 1; readonly value: string }\n');
rmSync(join(project, 'packages/public/dist/cli.js'));
await assert.rejects(() => checkApiArtifacts(project, baseline, options), /发布产物缺失.*cli.js/);
save('packages/public/dist/cli.js', '#!/usr/bin/env node\nexport const cli = true;\n');
rmSync(join(project, 'packages/public/dist/index.d.ts'));
await assert.rejects(() => checkApiArtifacts(project, baseline, options), /发布产物缺失.*index.d.ts/);
save('packages/public/dist/index.d.ts', 'export { Journal } from "./journal";\n');
save('packages/public/dist/index.js', 'export const = ;\n');
await assert.rejects(() => checkApiArtifacts(project, baseline, options), /发布产物语法无效.*index.js/);
save('packages/public/dist/index.js', 'export const ready = true;\n');
await checkApiArtifacts(project, baseline, options);
save('packages/public/package.json', { ...manifest, files: ['schemas', 'skills'] });
await assert.rejects(() => checkApiArtifacts(project, baseline, options), /npm 发布清单缺少 API 目标.*dist\/index/);
save('packages/public/package.json', { ...manifest, files: ['dist', 'skills'] });
await assert.rejects(() => checkApiArtifacts(project, baseline, options), /npm 发布清单缺少 API 目标.*schemas\/report.json/);
save('packages/public/package.json', { ...manifest, files: ['dist', 'schemas'] });
await assert.rejects(() => checkApiArtifacts(project, baseline, options), /npm 发布清单缺少 API 目标.*skills\/contract\/SKILL.md/);
save('packages/public/package.json', manifest);
await checkApiArtifacts(project, baseline, options);

const linkedProtocols = [
  { specifier: '@contract/public', symbol: 'JOURNAL_VERSION' },
  { ...protocol, sameAs: 'JOURNAL_VERSION', schema: '@contract/public/schema.json' },
];
save('packages/public/src/index.ts', 'export { Journal, JOURNAL_VERSION } from "./journal";\n');
save('packages/public/src/journal.ts', 'export const JOURNAL_VERSION = 1 as const;\nexport interface Journal { readonly version: 1 }\n');
save('packages/public/schemas/report.json', { ...schema, definitions: { Journal: { type: 'object', properties: { version: { const: 1 } } } } });
await collectApiContract(project, { protocols: linkedProtocols });
save('packages/public/src/journal.ts', 'export const JOURNAL_VERSION = 2 as const;\nexport interface Journal { readonly version: 1 }\n');
await assert.rejects(() => collectApiContract(project, { protocols: linkedProtocols }), /API 协议版本不一致.*Journal.version/);
save('packages/public/src/journal.ts', 'export const JOURNAL_VERSION = 1 as const;\nexport interface Journal { readonly version: 1 }\n');
save('packages/public/schemas/report.json', { ...schema, definitions: { Journal: { type: 'object', properties: { version: { const: 2 } } } } });
await assert.rejects(() => collectApiContract(project, { protocols: linkedProtocols }), /API 协议与 Schema 版本不一致.*Journal.version/);

assert.equal(readFileSync(join(project, 'packages/public/package.json'), 'utf8').includes('0.1.0'), true);
console.log('API 候选清单：包/导出条件、Schema 语义、协议版本、Skill、缺失与无效发布产物变异全部通过');
