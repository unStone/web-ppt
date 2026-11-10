/**
 * 公开 API 报告：对每个发布包 `exports` 里的每个类型入口生成 API Extractor 报告，
 * 存在 `packages/<包>/api/<入口>.api.md`，随代码一起评审。
 *
 *   npm run api:report        本地更新报告（构建后执行）
 *   npm run api:check         报告与当前构建不一致即失败（verify 链路调用）
 *
 * 1.0 前公开面要冻结：任何导出的增删改都会让 api:check 失败，迫使变更者同时提交新报告，
 * 公开 API 的变化因此出现在 PR diff 里，而不是靠手写的 api-stability.md 记忆。
 * 依赖 dist 下的 .d.ts，必须先 `npm run build`。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CompilerState, Extractor, ExtractorConfig } from '@microsoft/api-extractor';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

/** 报告文件名：`.` → index，`./pdf/vector` → pdf-vector */
const reportName = (subpath) => (subpath === '.' ? 'index' : subpath.replace(/^\.\//, '').replaceAll('/', '-'));

const packages = readdirSync(join(root, 'packages'))
  .sort()
  .map((dir) => ({ dir, file: join(root, 'packages', dir, 'package.json') }))
  .filter(({ file }) => existsSync(file))
  .map(({ dir, file }) => ({ dir, file, json: JSON.parse(readFileSync(file, 'utf8')) }))
  .filter(({ json }) => !json.private);

const failures = [];
let reports = 0;
for (const pkg of packages) {
  const entries = Object.entries(pkg.json.exports ?? {}).flatMap(([subpath, target]) =>
    typeof target === 'object' && target.types?.endsWith('.d.ts') ? [{ subpath, dts: join(root, 'packages', pkg.dir, target.types) }] : [],
  );
  if (!entries.length) throw new Error(`${pkg.json.name} 的 exports 里没有任何 .d.ts 类型入口`);
  const missing = entries.filter(({ dts }) => !existsSync(dts));
  if (missing.length) {
    throw new Error(`${pkg.json.name} 缺少类型产物：${missing.map(({ dts }) => dts).join('、')}；先运行 npm run build`);
  }

  const reportFolder = join(root, 'packages', pkg.dir, 'api');
  const reportTempFolder = join(root, 'out/api-report', pkg.dir);
  if (!check) mkdirSync(reportFolder, { recursive: true });
  mkdirSync(reportTempFolder, { recursive: true });
  const configFor = ({ subpath, dts }) =>
    ExtractorConfig.prepare({
      configObject: {
        projectFolder: join(root, 'packages', pkg.dir),
        mainEntryPointFilePath: dts,
        // 只分析已发布的 .d.ts：peer 包同样经 node_modules 解析到各自的 dist，与外部使用者看到的一致。
        compiler: {
          overrideTsconfig: {
            compilerOptions: {
              target: 'ES2020',
              module: 'ESNext',
              moduleResolution: 'bundler',
              lib: ['ES2020', 'DOM', 'DOM.Iterable'],
              strict: true,
              skipLibCheck: true,
              types: ['node'],
              allowJs: false,
            },
            files: [dts],
          },
        },
        apiReport: {
          enabled: true,
          reportFileName: reportName(subpath),
          reportFolder,
          reportTempFolder,
        },
        docModel: { enabled: false },
        dtsRollup: { enabled: false },
        tsdocMetadata: { enabled: false },
        messages: {
          compilerMessageReporting: { default: { logLevel: 'error' } },
          // 仓库不使用 @public / @beta 发布标签，注释也不按 TSDoc 规范书写；报告本身才是要评审的内容。
          extractorMessageReporting: { default: { logLevel: 'none' } },
          tsdocMessageReporting: { default: { logLevel: 'none' } },
        },
      },
      configObjectFullPath: undefined,
      packageJsonFullPath: pkg.file,
    });

  // 入口从 exports 移除后，旧报告会留下来假装该 API 还在；检查模式下直接判错。
  const expected = new Set(entries.map(({ subpath }) => `${reportName(subpath)}.api.md`));
  const orphans = existsSync(reportFolder)
    ? readdirSync(reportFolder).filter((file) => file.endsWith('.api.md') && !expected.has(file))
    : [];
  for (const file of orphans) failures.push(`${pkg.json.name}：api/${file} 没有对应的 exports 入口，删除该报告`);

  const configs = entries.map((entry) => ({ entry, config: configFor(entry) }));
  // 同一包的全部入口共用一次 TypeScript 分析
  const compilerState = CompilerState.create(configs[0].config, {
    additionalEntryPoints: configs.map(({ config }) => config.mainEntryPointFilePath),
  });
  for (const { entry, config } of configs) {
    const result = Extractor.invoke(config, { localBuild: !check, compilerState });
    reports++;
    if (!result.succeeded) {
      failures.push(
        `${pkg.json.name}${entry.subpath === '.' ? '' : entry.subpath.slice(1)}：`
          + (result.errorCount > 0
            ? `${result.errorCount} 个错误（见上方输出）`
            : '公开 API 与已提交报告不一致，确认后运行 npm run api:report 并提交'),
      );
    }
  }
}

if (failures.length) {
  console.error(`\x1b[31m✗ ${failures.length} 个入口的 API 报告未通过\x1b[0m`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(`\x1b[32m✓ ${packages.length} 个发布包、${reports} 个入口的 API 报告${check ? '与构建一致' : '已更新'}\x1b[0m`);
