/**
 * 发布包公开面的设计约束：按需能力保持按需、默认包可 tree-shake、类型契约全部纳入检查。
 *
 * 每个导出的具体签名由 api:check 的 API 报告约束；这里守的是报告表达不了的结构性决定——
 * 「这项能力必须是独立子路径、不能进默认入口」，否则 Agent 或宿主的一次顺手导出就会把
 * 模板、图片 ZIP 等大块代码拖进所有使用者的首屏包体。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from '@typescript/typescript6';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(root, file), 'utf8');
const json = (file) => JSON.parse(read(file));

const failures = [];
let passed = 0;
const check = (label, condition, detail = '') => {
  if (condition) passed++;
  else failures.push(detail ? `${label}：${detail}` : label);
};

const published = readdirSync(join(root, 'packages'))
  .sort()
  .filter((dir) => existsSync(join(root, 'packages', dir, 'package.json')))
  .map((dir) => ({ dir, manifest: json(`packages/${dir}/package.json`) }))
  .filter(({ manifest }) => !manifest.private);
const byDir = new Map(published.map((p) => [p.dir, p.manifest]));

for (const { dir, manifest } of published) {
  // core 的包 README 由 prepack 从根英文文档生成并被 gitignore；干净检出只能校验其唯一源文件。
  const readmeSource = dir === 'core' ? 'README.en.md' : `packages/${dir}/README.md`;
  check(`${manifest.name} README 源存在`, existsSync(join(root, readmeSource)));
  check(`${manifest.name} 公开根入口与 package.json`, !!manifest.exports?.['.'] && !!manifest.exports?.['./package.json']);
  // core 根入口注册图元解码 hook 等副作用，其余包必须可整体 tree-shake
  if (dir !== 'core') check(`${manifest.name} 声明无副作用`, manifest.sideEffects === false);
}

/** 必须以独立子路径交付、不进默认入口的能力 */
const ON_DEMAND = {
  core: ['./image-zip', './chart-edit', './chart-ex', './modern-charts'],
  'edit-core': ['./generate', './templates', './chart', './media', './appearance'],
  editor: ['./adjustments', './templates', './chart', './media', './accessibility', './edit-context'],
  'viewer-core': ['./comments'],
  react: ['./templates', './chart', './media'],
  vue: ['./templates', './chart', './media'],
};
for (const [dir, entries] of Object.entries(ON_DEMAND)) {
  const manifest = byDir.get(dir);
  for (const entry of entries) {
    check(`${manifest.name}${entry.slice(1)} 是独立子路径`, !!manifest.exports?.[entry]);
  }
}
const ROOT_EXCLUDED = [
  ['core', 'presentationToImageZip'],
  ...['edit-core', 'editor', 'react', 'vue'].map((dir) => [dir, 'createPptxFromTemplate']),
];
for (const [dir, symbol] of ROOT_EXCLUDED) {
  check(`${byDir.get(dir).name} 默认入口不导出 ${symbol}`, !read(`packages/${dir}/src/index.ts`).includes(symbol));
}

// 公开类型契约只有被 tsconfig 纳入，npm run check 才会检查它们
const tsconfig = ts.parseConfigFileTextToJson('tsconfig.json', read('tsconfig.json')).config;
for (const file of readdirSync(join(root, 'tooling/type-contracts'))
  .filter((f) => f.endsWith('.ts'))
  .sort()) {
  check(`类型契约 ${file} 纳入 tsconfig`, tsconfig.include.includes(`tooling/type-contracts/${file}`));
}

if (failures.length) {
  console.error(`\x1b[31m✗ 发布包公开面 ${failures.length} 项不符合约束\x1b[0m`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(`\x1b[32m✓ 发布包公开面约束通过（${passed} 项）\x1b[0m`);
