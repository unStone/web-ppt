/**
 * 以宿主视角真实编译九个发布包的全部类型入口（#74）。
 *
 * check-dts-resolution.mjs 核对的是声明文件内部的相对导入；这里从包名经 exports 进入，用仓库锁定的 tsc
 * 按使用者的 node16 / nodenext 配置编译一个临时消费工程（建在 out/dts-consumer/，用完即删）：
 *   - skipLibCheck: false —— 声明文件里的任何解析错误都会让编译失败；
 *   - skipLibCheck: true 下把 AgentMcpSessionManager 赋给 symbol —— 必须报 TS2322。解析失败时它是 any、
 *     赋值不报错，这正是 issue 报告的静默症状。
 * 依赖 dist，必须在 `npm run build` 之后执行。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = join(root, 'node_modules/typescript/bin/tsc');

const entries = readdirSync(join(root, 'packages'))
  .sort()
  .filter((dir) => existsSync(join(root, 'packages', dir, 'package.json')))
  .map((dir) => JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'), 'utf8')))
  .filter((manifest) => !manifest.private)
  .flatMap((manifest) =>
    Object.entries(manifest.exports).flatMap(([subpath, target]) =>
      typeof target === 'object' && target.types?.endsWith('.d.ts')
        ? [subpath === '.' ? manifest.name : `${manifest.name}/${subpath.slice(2)}`]
        : [],
    ),
  );
if (!entries.length) throw new Error('发布包的 exports 里没有任何 .d.ts 类型入口');

mkdirSync(join(root, 'out/dts-consumer'), { recursive: true });
const project = mkdtempSync(join(root, 'out/dts-consumer/case-'));
const failures = [];
try {
  writeFileSync(
    join(project, 'package.json'),
    `${JSON.stringify({ name: 'web-ppt-dts-consumer', private: true, type: 'module' }, null, 2)}\n`,
  );
  writeFileSync(
    join(project, 'entries.mts'),
    `${entries.map((entry, index) => `import type * as entry${index} from '${entry}';`).join('\n')}\n`,
  );
  writeFileSync(
    join(project, 'probe.mts'),
    "import { AgentMcpSessionManager } from '@web-ppt/agent-mcp';\nexport const probe: symbol = AgentMcpSessionManager;\n",
  );
  const compile = (file, module, skipLibCheck) => {
    const config = join(project, `tsconfig.${module}.${skipLibCheck}.json`);
    writeFileSync(
      config,
      `${JSON.stringify(
        { compilerOptions: { module, moduleResolution: module, strict: true, noEmit: true, skipLibCheck, types: ['node'] }, files: [file] },
        null,
        2,
      )}\n`,
    );
    const result = spawnSync(process.execPath, [tsc, '-p', config], { encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status === null) throw new Error(`tsc 进程被信号终止：${result.signal}`);
    return result.stdout + result.stderr;
  };
  for (const module of ['node16', 'nodenext']) {
    const output = compile('entries.mts', module, false);
    if (output.trim()) failures.push(`${module}：全部类型入口在 skipLibCheck: false 下编译有错误\n${output.trim()}`);
    const probe = compile('probe.mts', module, true);
    if (!/probe\.mts\(2,\d+\): error TS2322/.test(probe)) {
      failures.push(
        `${module}：AgentMcpSessionManager 赋给 symbol 应报 TS2322（拿到真实类型），实际输出：\n${probe.trim() || '（编译通过）'}`,
      );
    }
  }
} finally {
  rmSync(project, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\x1b[31m✗ ${failures.length} 项发布类型入口的宿主编译未通过\x1b[0m`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}
console.log(`\x1b[32m✓ ${entries.length} 个类型入口在 node16 / nodenext 下从包名解析到真实类型\x1b[0m`);
