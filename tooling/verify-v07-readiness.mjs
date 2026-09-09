import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { V07_OFFICE_ARTIFACTS } from './lib/v07-office-artifacts.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(root, file), 'utf8');
const json = (file) => JSON.parse(read(file));
const contains = (file, tokens) => tokens.every((token) => read(file).includes(token));
const isClosed = (source) => /^status: closed$/m
  .test(source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '');
const failures = [];
let passed = 0;
const check = (label, condition) => condition ? passed++ : failures.push(label);

const packageDirs = ['core', 'edit-core', 'viewer-core', 'editor', 'react', 'vue', 'fonts', 'collab'];
const packages = packageDirs.map((dir) => ({ dir, value: json(`packages/${dir}/package.json`) }));
check('八个发布包版本一致', new Set(packages.map(({ value }) => value.version)).size === 1);
check('主题与设计画布从默认公开面暴露', contains('packages/editor/src/index.ts', [
  'SetThemeCommand', 'ThemeState', 'SetMasterTextStyleCommand',
]) && contains('packages/editor/src/design/index.ts', [
  'createDesignEditor', 'listLayouts', 'queryLayout', 'listMasters', 'queryMaster',
]));
check('模板仅从四个按需入口暴露',
  json('packages/edit-core/package.json').exports?.['./templates']
    && json('packages/editor/package.json').exports?.['./templates']
    && json('packages/react/package.json').exports?.['./templates']
    && json('packages/vue/package.json').exports?.['./templates']
    && ['edit-core', 'editor', 'react', 'vue'].every((dir) =>
      !read(`packages/${dir}/src/index.ts`).includes('createPptxFromTemplate')));
check('框架适配只转发统一设计类型与模板入口',
  contains('packages/react/src/index.ts', ['DesignCommand', 'ThemeState', 'MasterDesignState'])
    && contains('packages/vue/src/index.ts', ['DesignCommand', 'ThemeState', 'MasterDesignState'])
    && contains('packages/react/src/templates/index.ts', ["from '@web-ppt/editor/templates'"])
    && contains('packages/vue/src/templates/index.ts', ["from '@web-ppt/editor/templates'"]));
check('可树摇包均声明无副作用', packages.slice(1).every(({ value }) => value.sideEffects === false));

const scripts = json('package.json').scripts;
check('普通页与设计权限有独立行为契约并接入主测试',
  existsSync(join(root, 'tooling/lib/v07-integration-contract.mjs'))
    && scripts.test.includes('test-v07-integration.mjs'));
check('无框架旅程有独立入口且可单独验收',
  scripts['test:v07'].includes('test-v07-integration.mjs'));
check('真实 Chrome 跨能力旅程接入浏览器主门禁',
  existsSync(join(root, 'tooling/lib/v07-integration-browser-contract.mjs'))
    && contains('tooling/editor-browser.html', ['runV07IntegrationBrowserContract']));
check('三套模板混合补丁接入协同主门禁',
  existsSync(join(root, 'tooling/lib/v07-collab-contract.mjs'))
    && contains('tooling/test-collab.mjs', ['runV07CollabContract']));
check('网站选择器按需加载且有真实浏览器下载契约',
  contains('packages/site/src/editor-page.ts', ['createSiteEditorApplication', 'application.opening?.create()', 'application.opening?.open(file', 'application.opening?.loadExample'])
    && contains('packages/site/src/editor-application.ts', ['context.plugin(editorOpenPlugin', 'host: openHost', "context.get('editorOpening')"])
    && contains('packages/site/src/editor-open-plugin.ts', ["import('./editor-template-picker')", 'chooseNewDocument(signal)'])
    && contains('packages/site/src/editor-template-picker.ts', [
      "from '@web-ppt/edit-core/templates'", 'listBuiltinTemplates()', 'createPptxFromTemplate',
    ])
    && contains('tooling/test-site-editor-browser.mjs', ['template-card', 'sample.pptx']));

check('0.7 Office 只有一份无重复清单', V07_OFFICE_ARTIFACTS.length === 11
  && new Set(V07_OFFICE_ARTIFACTS.map(({ file }) => file)).size === V07_OFFICE_ARTIFACTS.length
  && V07_OFFICE_ARTIFACTS.every(({ file, slides }) => file.endsWith('.pptx') && slides > 0));
check('LibreOffice 与 PowerPoint 消费同一清单',
  contains('tooling/test-v07-libreoffice-all.mjs', [
    'V07_OFFICE_ARTIFACTS', 'V07_OFFICE_MANIFEST', 'test-edit-libreoffice.mjs',
  ]) && contains('package.json', [
    'test:v07:libreoffice', 'out/v07-integration/office-artifacts.json',
    'out/v07-integration/powerpoint-report.json',
  ]) && contains('.github/workflows/powerpoint.yml', [
    'out/v07-integration/office-artifacts.json', 'out/v07-integration/powerpoint-report.json',
  ]));
check('PowerPoint 证据同时绑定提交、清单与产物字节',
  contains('tooling/test-edit-powerpoint.ps1', [
    'git rev-parse HEAD', 'git status --porcelain=v1', 'manifestSha256', 'Get-FileHash',
  ]) && contains('tooling/validate-edit-powerpoint-report.mjs', [
    'report.sourceRevision !== revision', 'report.manifestSha256', 'evidence.sha256 !== actualHash',
  ]));
check('固件可重生确定性有独立门禁',
  contains('package.json', ['test:fixtures:determinism'])
    && contains('tooling/test-fixture-determinism.mjs', ['npm', 'fixtures']));
check('0.7 公开类型契约覆盖主题、版式、母版与模板', [
  'v07-theme.ts', 'v07-layout.ts', 'v07-master.ts', 'v07-templates.ts',
].every((file) => existsSync(join(root, 'tooling/type-contracts', file))));

const trackedPptx = execFileSync('git', ['ls-files', '*.pptx'], { cwd: root, encoding: 'utf8' })
  .split('\n').filter(Boolean);
check('内置模板不以固定二进制交付', trackedPptx.every((file) => file.startsWith('fixtures/')));
check('中英文文档与更新日志公开 0.7 统一旅程和验收命令',
  contains('README.md', ['npm run test:v07', '模板 → 主题 → 母版 → 版式'])
    && contains('README.en.md', ['npm run test:v07', 'template → theme → master → layout'])
    && contains('CHANGELOG.md', ['0.7 集成验收', '普通页面权限隔离']));

const map = read('docs/wayfinder/ppt-template-theme/map.md');
const ticketDir = 'docs/wayfinder/ppt-template-theme/tickets';
const tickets = ['001-theme-editing.md', '002-layout-editing.md', '003-master-editing.md',
  '004-builtin-templates.md', '005-v07-integration-readiness.md'];
check('0.7 地图与五张票全部关闭', isClosed(map)
  && tickets.every((file) => isClosed(read(`${ticketDir}/${file}`))));

if (failures.length) {
  console.error(`\x1b[31m✗ 0.7 发布面审计失败（${failures.length} 项）\x1b[0m`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`\x1b[32m✓ 0.7 发布面审计通过（${passed} 项）\x1b[0m`);
}
