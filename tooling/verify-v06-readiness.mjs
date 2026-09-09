import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(root, file), 'utf8');
const packageDirs = ['core', 'edit-core', 'viewer-core', 'editor', 'react', 'vue', 'fonts', 'collab'];
const failures = [];
let passed = 0;
const check = (label, condition) => condition ? passed++ : failures.push(label);
const contains = (file, tokens) => {
  const source = read(file);
  return tokens.every((token) => source.includes(token));
};
const isClosed = (source) => /^status: closed$/m
  .test(source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '');

const packages = packageDirs.map((dir) => ({
  dir, json: JSON.parse(read(`packages/${dir}/package.json`)),
}));
check('八个发布包版本一致', new Set(packages.map(({ json }) => json.version)).size === 1);
for (const { dir, json } of packages) {
  // core 的包 README 由 prepack 从根英文文档生成并被 gitignore；CI 干净检出时只能校验其唯一源文件。
  const readmeSource = dir === 'core' ? 'README.en.md' : `packages/${dir}/README.md`;
  check(`${json.name} README 源存在`, existsSync(join(root, readmeSource)));
  check(`${json.name} 许可证与公开入口完整`, json.license === 'MIT'
    && !!json.exports?.['.'] && !!json.exports?.['./package.json']);
}
check('批量图片导出保持 core 按需入口',
  packages[0].json.exports?.['./image-zip']?.import === './dist/image-zip.js'
    && !read('packages/core/src/index.ts').includes('presentationToImageZip'));
check('生成保存保持 edit-core 按需入口',
  packages[1].json.exports?.['./generate']?.import === './dist/generate.js');
check('调节柄保持 editor 按需入口',
  packages[3].json.exports?.['./adjustments']?.import === './dist/adjustments.js');
check('默认包继续可 tree-shake', packages.slice(1).every(({ json }) => json.sideEffects === false));
check('editor 根入口公开七类查询与当前投影', contains('packages/editor/src/index.ts', [
  'queryTableGrid', 'queryParaProps', 'queryElementPresetGeometry', 'queryRunProps',
  'queryElementAltText', 'listSections', 'querySlideSize',
]) && contains('packages/editor/src/session.ts', ['toPresentation(): Presentation']));
check('adapter 与 React/Vue 共享 EditorSession',
  contains('packages/editor/src/framework-adapter-types.ts', ['session: EditorSession | null'])
    && contains('packages/react/src/web-ppt-editor.ts', ['EditorSession'])
    && contains('packages/vue/src/web-ppt-editor.ts', ['EditorSession']));
check('官网工具栏覆盖 0.6 可视入口与按需图片导出',
  contains('packages/site/editor.html', ['addTable', 'exportImages', 'editorInspector'])
    && contains('packages/site/src/editor-page.ts', ["import('./editor-application')", 'createSiteEditorApplication'])
    && contains('packages/site/src/editor-application.ts', ['context.plugin(editorPagePlugin', 'page.fileHost', 'page.connect(application)', 'context.plugin(editorFilesPlugin', 'context.editorFiles'])
    && contains('packages/site/src/editor-page-plugin.ts', ['fileHost: { buttons', 'application?.files', 'onTouchNavigate: viewport.onTouchNavigate'])
    && contains('packages/site/src/editor-files-plugin.ts', ['createEditorFileActions', "ctx.provide('editorFiles'", 'exportImages'])
    && contains('packages/site/src/editor-file-actions.ts', [
      "import('@web-ppt/core/image-zip')", 'session.toPresentation()', 'busy',
    ])
    && contains('packages/site/src/editor-inspector.ts', [
      'textBulletKind', 'shapePreset', 'textUnderlineStyle', 'textHighlight',
    ])
    && contains('tooling/test-site-editor-browser.mjs', ['--splitting', '--metafile=', 'dynamic-import'])
    && contains('.github/workflows/ci.yml', ['test-edit-libreoffice-all.mjs --include-site'])
    && contains('tooling/test-edit-libreoffice-all.mjs', [
      '--include-site', 'ALL_OFFICE_ARTIFACTS', 'EDIT_SAVE_OFFICE_ARTIFACTS',
    ]));
check('中英文 API 文档不再声称表格只能追加',
  contains('packages/edit-core/README-zh-CN.md', ['queryTableGrid', 'MergeCells', 'SetCellProps'])
    && contains('packages/edit-core/README.md', ['queryTableGrid', 'MergeCells', 'SetCellProps'])
    && !read('packages/edit-core/README-zh-CN.md').includes('当前有意只提供表格尾部追加语义')
    && !read('packages/edit-core/README.md').includes('intentionally exposes append-only'));
check('中英文根文档公开当前编辑态批量导出',
  contains('README.md', ['session.toPresentation()', '当前编辑态'])
    && contains('README.en.md', ['session.toPresentation()', 'current edited state']));
check('更新日志覆盖七类 0.6 能力与集成修复', contains('CHANGELOG.md', [
  '表格', '项目符号', '预设形状', '高级字符', '等距分布', '触屏', 'image-zip',
  '动态页码字段', '替代文字',
]));

const expectedTickets = [
  'tickets/001-table-structure-editing.md',
  'tickets/002-bullets-and-numbering.md',
  'tickets/003-preset-shape-adjustments.md',
  'tickets/004-advanced-run-formatting.md',
  'tickets/005-common-object-and-slide-commands.md',
  'tickets/006-touch-editing-gestures.md',
  'tickets/007-batch-image-export.md',
  'tickets/008-v06-integration-readiness.md',
];
const mapSource = read('docs/wayfinder/ppt-editing-completeness/map.md');
const ticketFiles = mapSource
  .match(/tickets\/\d{3}-[^)]+\.md/g) ?? [];
const exactTickets = [...new Set(ticketFiles)].sort();
check('0.6 地图与八张票全部关闭', isClosed(mapSource)
  && ticketFiles.length === expectedTickets.length
  && exactTickets.length === expectedTickets.length
  && exactTickets.every((file, index) => file === expectedTickets[index])
  && exactTickets.every((file) => isClosed(
    read(`docs/wayfinder/ppt-editing-completeness/${file}`),
  )));

if (failures.length) {
  console.error(`\x1b[31m✗ 0.6 发布面审计失败（${failures.length} 项）\x1b[0m`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`\x1b[32m✓ 0.6 发布面审计通过（${passed} 项）\x1b[0m`);
}
