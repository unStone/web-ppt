import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPlan, digest, expandScript, groupPlan, groupsForPhase, partitionFixtures } from './plan.mjs';
import { mergeResults, readJson, resultDirectory, writeJson } from './results.mjs';
import { expectedCountKeys } from './count-claims.mjs';
import { checkJobResults } from './job-status.mjs';

const jobs = (code, result) => ({ changes: { result: 'success', outputs: { code } }, build: { result } });
assert.doesNotThrow(() => checkJobResults(jobs('true', 'success')));
assert.doesNotThrow(() => checkJobResults(jobs('false', 'skipped')));
for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
  assert.throws(() => checkJobResults(jobs('true', result)), /预期 success/);
}
assert.throws(() => checkJobResults(jobs('false', 'success')), /预期 skipped/);
assert.throws(() => checkJobResults(jobs(undefined, 'skipped')), /输出无效/);
assert.throws(() => checkJobResults({ ...jobs('true', 'success'), changes: { result: 'failure' } }), /路径检查未成功/);
assert.throws(() => checkJobResults({ changes: jobs('true', 'success').changes }), /缺少门禁/);
import { runGroup } from './run-group.mjs';

const scripts = {
  'pretest:functional': 'node tooling/pre.mjs',
  'prepretest:functional': 'node tooling/must-not-run.mjs',
  'test:functional': 'node tooling/a.mjs && node tooling/test-edit-save.mjs && node tooling/test-edit-equivalence.mjs && npm run test:expanded',
  'test:expanded': 'node tooling/expanded.mjs',
  'pretest:expanded': 'node tooling/expanded-pre.mjs',
  'posttest:expanded': 'node tooling/expanded-post.mjs',
  verify: 'node tooling/base.mjs && npm run test:expanded:dist',
  'test:expanded:dist': 'node tooling/expanded.mjs --dist',
  postverify: 'node tooling/dist-agent.mjs',
  'pretest:ci:office': 'node tooling/external-pre.mjs',
  'test:ci:office': 'node tooling/external-save.mjs && node tooling/external-ole.mjs',
};
const source = createPlan(scripts, 'source');
assert.deepEqual(source.leaves.map((leaf) => leaf.command), [
  'node tooling/pre.mjs', 'node tooling/a.mjs', 'node tooling/test-edit-save.mjs', 'node tooling/test-edit-equivalence.mjs',
  'node tooling/expanded-pre.mjs', 'node tooling/expanded.mjs', 'node tooling/expanded-post.mjs',
]);
assert.equal(source.groups.agent[0].command, 'node tooling/pre.mjs');
assert.deepEqual(source.groups.saving.map((leaf) => leaf.command), ['node tooling/test-edit-save.mjs']);
assert.deepEqual(source.groups.editing.map((leaf) => leaf.command), ['node tooling/a.mjs']);
const ordered = createPlan({ ...scripts,
  'test:functional': 'node tooling/before.mjs && node tooling/test-edit-save.mjs && node tooling/after.mjs',
}, 'source');
assert.deepEqual(ordered.groups.editing.map((leaf) => leaf.command), ['node tooling/before.mjs', 'node tooling/after.mjs']);
assert.equal(createPlan({ ...scripts, verify: 'node tooling/test-edit-save.mjs' }, 'dist').groups.base[0].command,
  'node tooling/test-edit-save.mjs', '源码保存分组不能改变发布产物门禁分配');
assert.deepEqual(source.groups.expanded.map((leaf) => leaf.command), [
  'node tooling/expanded-pre.mjs', 'node tooling/expanded.mjs', 'node tooling/expanded-post.mjs',
]);
assert.deepEqual(createPlan(scripts, 'dist').groups.agent.map((leaf) => leaf.command), ['node tooling/dist-agent.mjs']);
assert.deepEqual(createPlan(scripts, 'external').groups.office.map((leaf) => leaf.command), [
  'node tooling/external-pre.mjs', 'node tooling/external-save.mjs', 'node tooling/external-ole.mjs',
]);
const added = { ...scripts, 'test:functional': `${scripts['test:functional']} && python3 tooling/new.py` };
assert.equal(createPlan(added, 'source').groups.editing.at(-1).command, 'python3 tooling/new.py');
for (const source of [
  'node tooling/a.mjs || node tooling/b.mjs', 'node "tooling/a.mjs"',
  'node tooling/a.mjs; node tooling/b.mjs', 'CHROME_BIN=x node tooling/a.mjs',
  'npm run test:expanded -- --new', 'node tooling/a.mjs &&', 'node tooling/a.mjs | cat',
]) assert.throws(() => expandScript({ test: source }, 'test'), /不支持|为空/);
assert.throws(() => expandScript({ a: 'npm run b', b: 'npm run a' }, 'a'), /循环/);
assert.throws(() => expandScript({ a: 'npm run absent' }, 'a'), /不存在/);
assert.throws(() => expandScript({ a: 'node tooling/a.mjs && node tooling/a.mjs' }, 'a'), /重复/);
const fixtures = Array.from({ length: 11 }, (_, index) => `sample-${index}.pptx`).sort();
const slices = Array.from({ length: 4 }, (_, index) => partitionFixtures(fixtures, index, 4));
assert.deepEqual(slices.flat().sort(), fixtures);
assert.equal(new Set(slices.flat()).size, fixtures.length);
assert.throws(() => partitionFixtures(fixtures, 4, 4), /无效/);
assert.throws(() => partitionFixtures(fixtures, 0.5, 4), /无效/);

const root = resolve(import.meta.dirname, '../..');
mkdirSync(join(root, 'out/ci-tests'), { recursive: true });
const temporary = mkdtempSync(join(root, 'out/ci-tests/test-'));
const revision = 'test-revision';
const runId = 'test-run';
mkdirSync(join(temporary, 'tooling'), { recursive: true });
const files = {
  'pre.mjs': "recordCount('pre', 1);",
  'a.mjs': "recordCount('a', 2);",
  'test-edit-save.mjs': "recordCount('save', 5);",
  'expanded.mjs': "recordCount('expanded', 3);",
  'test-edit-equivalence.mjs': "recordCount('fixtures', 1); recordCount('equivalence', 2);",
  'expanded-pre.mjs': '', 'expanded-post.mjs': '', 'base.mjs': '', 'dist-agent.mjs': '',
  'external-pre.mjs': '', 'external-save.mjs': '', 'external-ole.mjs': "countedAssert('oleLibreOffice');",
};
for (const [name, contents] of Object.entries(files)) writeFileSync(join(temporary, 'tooling', name), contents);
function fakeResults(phase) {
  for (const group of groupsForPhase(phase)) {
    const directory = resultDirectory(temporary, phase, group);
    const plan = groupPlan(scripts, phase, group);
    const counts = phase === 'source'
      ? group === 'saving' ? { save: 5 } : group === 'editing' ? { a: 2 } : group === 'agent' ? { pre: 1 } : group === 'expanded' ? { expanded: 3 } : {}
      : phase === 'external' ? { oleLibreOffice: 11 } : group === 'expanded' ? { expanded: 3 } : {};
    if (group.startsWith('equivalence-')) {
      const index = Number(group.slice('equivalence-'.length));
      const selected = partitionFixtures(fixtures, index, 4);
      Object.assign(counts, { fixtures: selected.length, equivalence: selected.length * 2 });
      writeJson(join(directory, 'equivalence.json'), { index, total: 4, fixtures: selected, svgCount: counts.equivalence });
    }
    writeJson(join(directory, 'plan.json'), plan);
    writeJson(join(directory, 'counts.json'), counts);
    writeJson(join(directory, 'result.json'), {
      version: 1, phase, group, revision, runId, planDigest: digest(plan), countsDigest: digest(counts), status: 'success',
      commands: plan.commands.map((leaf) => ({ id: leaf.id, command: leaf.command, status: 'success', durationMs: 1 })),
      durationMs: plan.commands.length,
    });
  }
}
const merge = (phase, overrides = {}) => mergeResults({ root: temporary, scripts, phase, revision, fixtures, runId, ...overrides });
try {
  fakeResults('source');
  fakeResults('dist');
  assert.throws(() => merge('source'), /external\/office 缺少 plan/);
  assert.throws(() => merge('all'), /external\/office 缺少 plan/);
  fakeResults('external');
  assert.deepEqual(merge('source').counts, { fixtures: fixtures.length, equivalence: fixtures.length * 2, save: 5, a: 2, pre: 1, expanded: 3, oleLibreOffice: 11 });
  assert.deepEqual(merge('all').counts, merge('source').counts);
  assert.equal(merge('source').summaries.filter((summary) => summary.phase === 'external').length, 1);
  assert.equal(merge('all').summaries.filter((summary) => summary.phase === 'external').length, 1);
  const office = resultDirectory(temporary, 'external', 'office');
  writeJson(join(office, 'counts.json'), {});
  const missingOfficeCount = readJson(join(office, 'result.json'));
  missingOfficeCount.countsDigest = digest({});
  writeJson(join(office, 'result.json'), missingOfficeCount);
  assert.throws(() => merge('source'), /oleLibreOffice/);
  assert.throws(() => merge('all'), /oleLibreOffice/);
  fakeResults('external');
  const oldOffice = readJson(join(office, 'result.json'));
  writeJson(join(office, 'result.json'), { ...oldOffice, runId: 'previous-run' });
  assert.throws(() => merge('source'), /external\/office 未成功执行/);
  writeJson(join(office, 'result.json'), { ...oldOffice, revision: 'old-revision' });
  assert.throws(() => merge('all'), /external\/office 未成功执行/);
  fakeResults('external');
  assert.throws(() => merge('source', { revision: 'old-revision' }), /当前提交/);
  assert.throws(() => merge('source', { runId: 'previous-run' }), /当前提交/);
  assert.throws(() => merge('source', { scripts: added }), /执行计划/);
  rmSync(join(resultDirectory(temporary, 'source', 'saving'), 'result.json'));
  assert.throws(() => merge('source'), /source\/saving 缺少 result/);
  fakeResults('source');
  const editing = resultDirectory(temporary, 'source', 'editing');
  rmSync(join(editing, 'counts.json'));
  assert.throws(() => merge('source'), /缺少 counts/);
  fakeResults('source');
  writeJson(join(editing, 'counts.json'), {});
  assert.throws(() => merge('source'), /计数丢失/);
  fakeResults('source');
  const emptyCounts = readJson(join(editing, 'result.json'));
  emptyCounts.countsDigest = digest({});
  writeJson(join(editing, 'counts.json'), {});
  writeJson(join(editing, 'result.json'), emptyCounts);
  assert.throws(() => merge('source'), /缺少源码声明的计数/);
  fakeResults('source');
  const report = readJson(join(editing, 'result.json'));
  report.commands.push(report.commands[0]);
  writeJson(join(editing, 'result.json'), report);
  assert.throws(() => merge('source'), /命令缺失、重复/);
  fakeResults('source');
  const evidence = resultDirectory(temporary, 'source', 'equivalence-0');
  writeJson(join(evidence, 'equivalence.json'), { index: 0, total: 4, fixtures: [], svgCount: 0 });
  assert.throws(() => merge('source'), /固件覆盖/);
  fakeResults('source');
  const expanded = resultDirectory(temporary, 'dist', 'expanded');
  writeJson(join(expanded, 'counts.json'), { expanded: 4 });
  const conflict = readJson(join(expanded, 'result.json'));
  conflict.countsDigest = digest({ expanded: 4 });
  writeJson(join(expanded, 'result.json'), conflict);
  assert.throws(() => merge('all'), /计数冲突/);
  const measured = pathToFileURL(join(root, 'tooling/lib/measured.mjs')).href;
  writeFileSync(join(temporary, 'tooling/success.mjs'), `import { recordCount } from ${JSON.stringify(measured)}; recordCount('success', 7);`);
  const run = (phase, command) => runGroup({
    root: temporary, phase, group: phase === 'source' ? 'editing' : 'base', revision, runId,
    scripts: { 'test:functional': command, verify: command },
  });
  const executed = run('source', 'node tooling/success.mjs');
  assert.equal(executed.status, 'success');
  assert.deepEqual(readJson(join(editing, 'counts.json')), { success: 7 });
  assert.ok(!existsSync(join(temporary, 'out/verify/counts.json')), '分组计数不能污染默认输出');
  assert.throws(() => run('dist', 'node tooling/success.mjs'), /全部源码分组计数/);
  writeJson(join(temporary, 'out/verify/counts.json'), { sourceProof: 42 });
  run('dist', 'node tooling/success.mjs');
  assert.deepEqual(readJson(join(resultDirectory(temporary, 'dist', 'base'), 'counts.json')), { sourceProof: 42, success: 7 });
  runGroup({ root: temporary, phase: 'external', group: 'office', revision, runId,
    scripts: { 'test:ci:office': 'node tooling/success.mjs' },
  });
  assert.deepEqual(readJson(join(office, 'counts.json')), { success: 7 }, '外部读取器组必须使用独立空计数');
  writeFileSync(join(temporary, 'tooling/failure.mjs'), 'process.exit(7);');
  writeFileSync(join(temporary, 'tooling/later.mjs'), "throw new Error('不得运行');");
  assert.throws(() => run('source', 'node tooling/failure.mjs && node tooling/later.mjs'), /exit=7/);
  const failed = readJson(join(editing, 'result.json'));
  assert.equal(failed.status, 'failure');
  assert.equal(failed.commands.length, 1, '失败必须立即终止当前分组');
  writeFileSync(join(temporary, 'tooling/a.mjs'), "countedAssert('newSuite'); recordCount('a', 1); recordCount('a', 1);");
  assert.deepEqual(expectedCountKeys(temporary, source.groups.editing), ['a', 'newSuite']);
  writeFileSync(join(temporary, 'tooling/a.mjs'), 'recordCount(key, 1);');
  assert.throws(() => expectedCountKeys(temporary, source.groups.editing), /字面量/);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
console.log('CI 编排：生命周期、唯一清单、默认分组、未知语法拒绝、分片全集与结果完整性全部通过');
