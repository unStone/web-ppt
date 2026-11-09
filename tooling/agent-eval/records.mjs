import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export { readJsonl, inspectCliEvents } from './cli-events.mjs';
export { inspectProtocol } from './run-protocol.mjs';

const conditions = ['with-lint', 'without-lint'];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const textExtensions = ['.json', '.jsonl', '.toml', '.txt', '.log', '.md'];

export function summarizeResults(results) {
  const classification = (row) => {
    if (row.pass) return null;
    if (!row.attempted) return 'infrastructure';
    if (row.failures.some((item) => item.category === 'resource')) return 'resource';
    if (row.failures.some((item) => item.category === 'infrastructure')) return 'infrastructure';
    if (row.failures.some((item) => item.category === 'protocol')) return 'protocol';
    return 'task';
  };
  for (const row of results) {
    assert.equal(typeof row.attempted, 'boolean', '运行结果必须明确是否观测到CLI进程启动');
    assert(Array.isArray(row.failures), '运行结果必须包含失败原因列表');
    assert(!row.pass || (row.attempted && row.failures.length === 0), '未启动或存在失败的运行不能报告成功');
  }
  const summary = {
    version: 1,
    conditions: {},
    countDefinitions: {
      attempted: 'Observed CLI process PID; missing records do not prove startup',
      highLevelFailures:
        'Mutually exclusive terminal outcome: resource > infrastructure > protocol > task; resource requires observed runner/host budget evidence',
      semanticCompletionRate: 'Saved bytes pass final semantic judgment; does not waive workflow, protocol or budget failures',
      failuresByReason: 'Per-run reason counts may overlap; do not sum as failed runs',
    },
    pairs: { planned: 0, recorded: 0, attempted: 0, evaluable: 0, evaluated: 0, bothPassed: 0, withOnly: 0, withoutOnly: 0, neither: 0 },
    limitations: [
      '受控任务与有限配对样本不支持普遍因果结论。',
      '基础设施失败单独保留，不归因于自动 lint 反馈。',
      '资源限制表示在统一预算下终止，不断言其根因一定来自模型或外部服务；所有原始诊断仍保留。',
    ],
  };
  for (const condition of conditions) {
    const rows = results.filter((row) => row.condition === condition);
    const attempted = rows.filter((row) => row.attempted).length;
    const passed = rows.filter((row) => row.pass).length;
    const semanticPassed = rows.filter((row) => row.semanticPass === true).length;
    const semanticUnknown = rows.filter((row) => typeof row.semanticPass !== 'boolean').length;
    const infrastructureFailures = rows.filter((row) => classification(row) === 'infrastructure').length;
    const evaluable = rows.filter((row) => row.attempted && classification(row) !== 'infrastructure').length;
    const failuresByReason = {};
    const usageTotals = {};
    for (const row of rows) {
      for (const reason of new Set(row.failures.map((failure) => failure.reason))) {
        failuresByReason[reason] = (failuresByReason[reason] ?? 0) + 1;
      }
      for (const usage of row.usage ?? []) {
        for (const [key, value] of Object.entries(usage)) {
          if (typeof value === 'number' && Number.isFinite(value)) usageTotals[key] = (usageTotals[key] ?? 0) + value;
        }
      }
    }
    summary.conditions[condition] = {
      planned: rows.length,
      total: rows.length,
      attempted,
      notStarted: rows.length - attempted,
      passed,
      failed: rows.length - passed,
      infrastructureFailures,
      resourceFailures: rows.filter((row) => classification(row) === 'resource').length,
      taskFailures: rows.filter((row) => classification(row) === 'task').length,
      protocolFailures: rows.filter((row) => classification(row) === 'protocol').length,
      completionRate: rows.length ? passed / rows.length : null,
      semanticAssessed: rows.filter((row) => row.semanticAssessed === true).length,
      semanticPassed,
      semanticUnknown,
      semanticCompletionRate: rows.length && !semanticUnknown ? semanticPassed / rows.length : null,
      attemptedCompletionRate: attempted ? passed / attempted : null,
      evaluable,
      evaluableCompletionRate: evaluable ? passed / evaluable : null,
      usageTotals: Object.keys(usageTotals).length ? usageTotals : null,
      unknownUsageRuns: rows.filter((row) => row.attempted && !row.usage?.length).length,
      failuresByReason,
    };
  }
  const pairs = new Map();
  for (const row of results) {
    assert(conditions.includes(row.condition), `未知评测条件：${row.condition}`);
    const key = `${row.taskId}:${row.repetition}`;
    if (!pairs.has(key)) pairs.set(key, {});
    assert(!pairs.get(key)[row.condition], `重复配对结果：${key}/${row.condition}`);
    pairs.get(key)[row.condition] = row;
  }
  summary.pairs.planned = pairs.size;
  for (const pair of pairs.values()) {
    const withLint = pair['with-lint'];
    const withoutLint = pair['without-lint'];
    if (!withLint || !withoutLint) continue;
    summary.pairs.recorded++;
    if (!withLint.attempted || !withoutLint.attempted) continue;
    summary.pairs.attempted++;
    if ([withLint, withoutLint].some((row) => classification(row) === 'infrastructure')) continue;
    summary.pairs.evaluable++;
    summary.pairs.evaluated++;
    const property = withLint.pass ? (withoutLint.pass ? 'bothPassed' : 'withOnly') : withoutLint.pass ? 'withoutOnly' : 'neither';
    summary.pairs[property]++;
  }
  return summary;
}

async function filesIn(directory, prefix = '') {
  const files = [];
  for (const name of (await readdir(join(directory, prefix))).sort()) {
    const path = join(prefix, name);
    const stat = await lstat(join(directory, path));
    if (stat.isSymbolicLink()) throw new Error(`证据目录不允许符号链接：${path}`);
    if (stat.isDirectory()) files.push(...(await filesIn(directory, path)));
    else if (stat.isFile()) files.push(path);
    else throw new Error(`证据目录含非普通文件：${path}`);
  }
  return files;
}

function inside(base, path) {
  const from = relative(base, path);
  return from && from !== '..' && !from.startsWith(`..${sep}`) && !isAbsolute(from);
}

function portableText(text, mappings) {
  let result = text;
  for (const [source, target] of mappings) result = result.replaceAll(source, target);
  // 发现认证材料时停止导出；不能把凭据静默改写成看似原始的证据。
  if (
    /\bnpm_[A-Za-z0-9]{20,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}|authorization["']?\s*[:=]\s*["']?bearer\s+[A-Za-z0-9_.-]{12,}/i.test(result)
  ) {
    throw new Error('证据文本疑似含认证材料，已拒绝导出；原始文件仍保留于本机目录');
  }
  return result;
}

export async function exportBundle({ sourceDirectory, destination, repoRoot }) {
  const source = await realpath(resolve(sourceDirectory));
  const target = resolve(destination);
  if (source === target || inside(source, target) || inside(target, source)) {
    throw new Error(`证据源目录与目标目录不能包含彼此：${source} → ${target}`);
  }
  try {
    await lstat(target);
    throw Object.assign(new Error(`拒绝覆盖已有证据目录：${target}`), { code: 'EEXIST' });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(target), { recursive: true });
  assert(!inside(source, await realpath(dirname(target))), '证据真实目标父目录不能位于源目录中');
  // mkdir独占目标，所有文件wx写入；清单最后落盘，半份目录不会被误判为有效证据。
  await mkdir(target);
  const mappings = [
    [source, '<experiment>'],
    [resolve(sourceDirectory), '<experiment>'],
    [resolve(repoRoot), '<repo>'],
    [homedir(), '<home>'],
  ]
    .filter(([path]) => path.length > 1)
    .sort((left, right) => right[0].length - left[0].length);
  const files = [];
  for (const path of await filesIn(source)) {
    if (path === 'evidence-manifest.json') throw new Error('源目录已包含证据清单，禁止嵌套导出');
    const input = await readFile(join(source, path));
    const bytes = textExtensions.some((extension) => path.endsWith(extension))
      ? Buffer.from(portableText(input.toString('utf8'), mappings))
      : input;
    await mkdir(dirname(join(target, path)), { recursive: true });
    await writeFile(join(target, path), bytes, { flag: 'wx' });
    files.push({ path: path.split(sep).join('/'), bytes: bytes.length, sha256: sha(bytes), rawSha256: sha(input) });
  }
  const manifest = { version: 1, transformation: 'host-absolute-path-mapping-only', files };
  await writeFile(join(target, 'evidence-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return manifest;
}

export async function verifyBundle(directory) {
  const root = await realpath(resolve(directory));
  const manifest = JSON.parse(await readFile(join(root, 'evidence-manifest.json'), 'utf8'));
  assert.equal(manifest.version, 1, '证据清单版本必须为1');
  assert(Array.isArray(manifest.files), '证据清单缺少files');
  const seen = new Set();
  for (const file of manifest.files) {
    assert.equal(typeof file.path, 'string', '证据清单缺少文件路径');
    const path = resolve(root, file.path);
    assert(inside(root, path), `证据路径越界：${file.path}`);
    assert(!seen.has(file.path), `证据清单路径重复：${file.path}`);
    seen.add(file.path);
    assert(inside(root, await realpath(path)), `证据真实路径越界：${file.path}`);
    assert((await lstat(path)).isFile() && !(await lstat(path)).isSymbolicLink(), `证据必须是普通文件：${file.path}`);
    const bytes = await readFile(path);
    assert.equal(bytes.length, file.bytes, `证据字节数不符：${file.path}`);
    assert.equal(sha(bytes), file.sha256, `证据哈希不符：${file.path}`);
  }
  const actual = (await filesIn(root)).filter((path) => path !== 'evidence-manifest.json').map((path) => path.split(sep).join('/'));
  assert.deepEqual(actual.sort(), [...seen].sort(), '证据清单必须覆盖全部文件');
  return manifest;
}
