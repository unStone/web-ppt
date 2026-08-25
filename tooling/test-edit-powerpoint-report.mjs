import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const validator = join(projectRoot, 'tooling/validate-edit-powerpoint-report.mjs');
const temp = mkdtempSync(join(tmpdir(), 'web-ppt-powerpoint-report-'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
let passed = 0;
const failures = [];

const check = (name, condition, detail = '') => {
  if (condition) {
    passed++;
    console.log(`\x1b[32m✓\x1b[0m ${name}`);
  } else {
    failures.push(`${name}${detail ? `：${detail}` : ''}`);
    console.error(`\x1b[31m✗\x1b[0m ${name}${detail ? `：${detail}` : ''}`);
  }
};

const run = (manifest, report, repository) => spawnSync(
  process.execPath,
  [validator, '--manifest', manifest, '--report', report],
  { cwd: repository, encoding: 'utf8' },
);

try {
  const evidenceDir = join(temp, 'evidence');
  mkdirSync(evidenceDir);
  const artifactBytes = Buffer.from('deterministic-pptx-evidence');
  const artifactPath = join(evidenceDir, 'single-move.pptx');
  const manifestPath = join(evidenceDir, 'office-artifacts.json');
  const reportPath = join(evidenceDir, 'powerpoint-report.json');
  writeFileSync(artifactPath, artifactBytes);

  const manifest = {
    version: 1,
    artifacts: [{ file: 'single-move.pptx', slides: 1 }],
  };
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(manifestPath, manifestBytes);
  const ignorePath = join(temp, '.gitignore');
  const ignoreBytes = 'evidence/powerpoint-report.json\n';
  writeFileSync(ignorePath, ignoreBytes);
  execFileSync('git', ['init', '-q'], { cwd: temp });
  execFileSync('git', ['add', '.'], { cwd: temp });
  execFileSync('git', [
    '-c', 'user.name=Web PPT Tests',
    '-c', 'user.email=tests@example.invalid',
    'commit', '-qm', 'test fixture',
  ], { cwd: temp });
  const now = Date.now();

  const report = {
    version: 1,
    generatedAt: new Date(now - 60_000).toISOString(),
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: temp,
      encoding: 'utf8',
    }).trim(),
    manifestSha256: sha256(manifestBytes),
    powerPoint: { version: '16.0', build: '19127' },
    environment: { userInteractive: true, sessionId: 1 },
    artifacts: [{
      file: 'single-move.pptx',
      sha256: sha256(artifactBytes),
      expectedSlides: 1,
      actualSlides: 1,
      openedWithoutRepair: true,
    }],
    passed: true,
    failure: null,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const valid = run(manifestPath, reportPath, temp);
  check('当前 PowerPoint 证据绑定完整清单与产物字节', valid.status === 0,
    `${valid.stdout}${valid.stderr}`.trim());

  writeFileSync(artifactPath, Buffer.from('changed-after-powerpoint-open'));
  const changed = run(manifestPath, reportPath, temp);
  check('PowerPoint 打开后被替换的产物不能复用旧报告', changed.status !== 0
    && changed.stderr.includes('SHA-256'));
  writeFileSync(artifactPath, artifactBytes);

  const missingReport = { ...report, artifacts: [] };
  writeFileSync(reportPath, `${JSON.stringify(missingReport, null, 2)}\n`);
  const missing = run(manifestPath, reportPath, temp);
  check('漏验清单中任一产物都会失败', missing.status !== 0
    && missing.stderr.includes('清单'));

  const failedReport = { ...report, passed: false, failure: 'PowerPoint 拒绝打开' };
  writeFileSync(reportPath, `${JSON.stringify(failedReport, null, 2)}\n`);
  const failed = run(manifestPath, reportPath, temp);
  check('COM 验收失败不能伪装成成功证据', failed.status !== 0
    && failed.stderr.includes('PowerPoint 拒绝打开'));

  const staleReport = { ...report, generatedAt: new Date(now - 2 * 60 * 60_000).toISOString() };
  writeFileSync(reportPath, `${JSON.stringify(staleReport, null, 2)}\n`);
  const stale = run(manifestPath, reportPath, temp);
  check('超过一小时的报告不能证明当前门禁', stale.status !== 0
    && stale.stderr.includes('过期'));

  const otherRevision = { ...report, sourceRevision: '0000000000000000000000000000000000000000' };
  writeFileSync(reportPath, `${JSON.stringify(otherRevision, null, 2)}\n`);
  const revision = run(manifestPath, reportPath, temp);
  check('其他提交的 PowerPoint 结果不能证明当前源码', revision.status !== 0
    && revision.stderr.includes('当前源码'));

  const sessionZero = { ...report, environment: { userInteractive: true, sessionId: 0 } };
  writeFileSync(reportPath, `${JSON.stringify(sessionZero, null, 2)}\n`);
  const session = run(manifestPath, reportPath, temp);
  check('Session 0 不能产生桌面 PowerPoint 成功证据', session.status !== 0
    && session.stderr.includes('交互式'));

  const wrongPages = {
    ...report,
    artifacts: [{ ...report.artifacts[0], actualSlides: 2 }],
  };
  writeFileSync(reportPath, `${JSON.stringify(wrongPages, null, 2)}\n`);
  const pages = run(manifestPath, reportPath, temp);
  check('报告页数必须与清单和 PowerPoint 实际值一致', pages.status !== 0
    && pages.stderr.includes('页数'));

  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(ignorePath, `${ignoreBytes}# dirty tracked source\n`);
  const dirty = run(manifestPath, reportPath, temp);
  writeFileSync(ignorePath, ignoreBytes);
  check('脏工作树不能生成冒充当前 HEAD 的证据', dirty.status !== 0
    && dirty.stderr.includes('工作树'));
} finally {
  rmSync(temp, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n\x1b[31m✗ ${failures.length} 项 PowerPoint 证据契约失败\x1b[0m`);
  process.exitCode = 1;
} else {
  console.log(`\n\x1b[32m✓ PowerPoint 证据契约全部通过（${passed} 项断言）\x1b[0m`);
}
