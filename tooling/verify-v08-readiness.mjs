import ts from 'typescript';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { V08_OFFICE_ARTIFACTS } from './lib/v08-office-artifacts.mjs';

const root = resolve(import.meta.dirname, '..');
const read = (name) => readFileSync(resolve(root, name), 'utf8');
const json = (name) => JSON.parse(read(name));
const checks = [];
const check = (label, condition) => { assert(condition, label); checks.push(label); };
const requiredEntries = {
  core: ['./chart-edit', './chart-ex', './modern-charts', './image-zip'],
  'edit-core': ['./chart', './media', './appearance'],
  editor: ['./chart', './media', './accessibility', './edit-context'],
  'viewer-core': ['./comments'], react: ['./chart', './media'], vue: ['./chart', './media'],
};
for (const [pkg, entries] of Object.entries(requiredEntries)) {
  const manifest = json(`packages/${pkg}/package.json`);
  check(`${pkg} 按需 exports 与类型实际落盘`, entries.every((entry) => {
    const target = manifest.exports[entry];
    return target && ['import', 'types'].every((kind) => existsSync(resolve(root, 'packages', pkg, target[kind])));
  }));
}
check('批注源码和发布产物执行同一保存/导出/面板契约',
  json('out/comments/source-report.json').passed === 31 && json('out/comments/dist-report.json').passed === 31);
const mixed = json('out/v08-dist/report.json');
check('完整混合契约从包名消费发布产物', mixed.packageConsumption === true && mixed.passed === 13);
const fixture = unzipSync(readFileSync(resolve(root, 'fixtures/sample-editor-mixed.pptx')));
check('固件包含全部八种现代布局', ['treemap', 'sunburst', 'clusteredColumn', 'paretoLine', 'boxWhisker', 'waterfall', 'funnel', 'regionMap']
  .every((kind) => Object.entries(fixture).some(([name, bytes]) => /\/chartEx\d+\.xml$/.test(name) && strFromU8(bytes).includes(`layoutId="${kind}"`))));
check('同一固件包含音视频与批注部件', ['ppt/media/mixed.wav', 'ppt/media/mixed.mp4', 'ppt/comments/comment1.xml', 'ppt/commentAuthors.xml'].every((name) => fixture[name]?.length));
const manifest = json('out/v08-integration/office-artifacts.json');
check('统一 Office 清单与生成器完全一致且无重复', JSON.stringify(manifest.artifacts) === JSON.stringify(V08_OFFICE_ARTIFACTS)
  && new Set(manifest.artifacts.map((a) => a.file)).size === V08_OFFICE_ARTIFACTS.length);
check('统一清单每件产物均存在', manifest.artifacts.every((a) => existsSync(resolve(root, 'out/v08-integration', a.file))));
const scripts = json('package.json').scripts;
check('源码批注和全类型混合进入主门禁', scripts['test:functional'].includes('test:comments') && read('tooling/test-edit-save.mjs').includes('runMixedEditingContract'));
check('语料专项不覆盖默认断言计数', read('tooling/test-chartex-native.mjs').includes("if (!process.argv.includes('--corpus')) recordCount('chartexNative', passed)"));
check('批注与新能力公开类型契约进入 check', ['comments.ts', 'chartex.ts', 'appearance-browser.ts', 'v08-chart.ts', 'media.ts']
  .every((file) => ts.parseConfigFileTextToJson('tsconfig.json', read('tsconfig.json')).config.include.includes(`tooling/type-contracts/${file}`)));
mkdirSync(resolve(root, 'out/v08-integration'), { recursive: true });
writeFileSync(resolve(root, 'out/v08-integration/readiness.json'), JSON.stringify({
  functionalChecks: checks, artifacts: manifest.artifacts.length,
  externalValidation: { windowsPowerPoint: 'deferred-by-user', nativeOfficeCorpus: 'see docs/chartex-native.md' },
}, null, 2) + '\n');
console.log(`0.8 功能完成度检查通过：${checks.length} 项；Office 清单 ${manifest.artifacts.length} 件；Windows 真机暂缓`);
