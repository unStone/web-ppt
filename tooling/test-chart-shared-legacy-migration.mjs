import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { moduleClosure } from './lib/module-closure.mjs';
import { runLegacyBareModel } from './lib/chart-shared-unresolved-contract.mjs';
import { runExtensionMigrationReceipt, runExtensionMigrationPaths, runExtensionMigrationTransport, runExtensionMigrationDeferred }
  from './lib/extension-migration-receipt-contract.mjs';
import { runVersionedChartConflict, resumeVersionedChartConflict } from './lib/chart-shared-versioned-conflict-contract.mjs';
import { runMigrationRecoveryOrder, runMigrationResolverDisposal } from './lib/extension-migration-recovery-contract.mjs';
import { runConflictEvidence, resumeConflictEvidence } from './lib/chart-shared-conflict-evidence-contract.mjs';
import { runRemoteMigration, resumeRemoteMigration } from './lib/chart-shared-remote-migration-contract.mjs';
import { runChartCopyVersions, resumeChartCopyVersions, runChartCopyTransaction, runChartCopyDeletion } from './lib/chart-shared-copy-version-contract.mjs';
import { runChartCopyRedo, resumeChartCopyRedo, runChartCopyHistorySemantics } from './lib/chart-shared-copy-redo-contract.mjs';
import { runChartCopyLate, resumeChartCopyLate } from './lib/chart-shared-copy-late-contract.mjs';
import { resumeChartCopyRemoteRestore } from './lib/chart-shared-copy-remote-restore-contract.mjs';
import { runLegacyChartShapeMatrix, runLegacyChartShape, resumeLegacyChartShape } from './lib/chart-shared-legacy-shapes-contract.mjs';
import { runLegacyMigrationHistory, runLegacyMigrationMessages, runLegacyMigrationCheckpoint, resumeLegacyMigrationCheckpoint }
  from './lib/chart-shared-legacy-migration-contract.mjs';
import { runLegacyMigrationAnnouncements, receiveLegacyMigrationAnnouncements,
  runLegacyMigrationTransportLimit, runLegacyMigrationRecoveryLimit, runLegacyMigrationLateFirst,
  runLegacyMigrationEarlyRecovery, resumeLegacyMigrationEarlyRecovery }
  from './lib/chart-shared-legacy-transport-contract.mjs';
import { runLegacyMigrationAddresses, runLegacyMigrationConstructor } from './lib/chart-shared-legacy-address-contract.mjs';
import { runVersionedChartRegisters, resumeVersionedChartRegisters, runVersionedChartRegisterRemap }
  from './lib/chart-shared-versioned-register-contract.mjs';
import { runVersionedChartBinding, runVersionedChartDeferred, runVersionedChartOpaqueRegister }
  from './lib/chart-shared-versioned-boundary-contract.mjs';
import { runLegacyMigrationPrecopied, runLegacyMigrationDisjoint, runLegacyMigrationExisting,
  runLegacyMigrationConflicting, runLegacyMigrationConcurrentCopy, runLegacyMigrationRemovedOriginal,
  runLegacyMigrationCustomIdentity, runLegacyMigrationRemovedSourceSlide, runLegacyMigrationIdentityCollision,
  runLegacyMigrationRemovedCopyChain, runLegacyMigrationRemovedSlideMessage,
  runLegacyMigrationConcurrentRemoval,
  resumeLegacyMigrationRemovedSourceSlide }
  from './lib/chart-shared-legacy-merge-contract.mjs';

const dist = process.argv.includes('--dist'), variant = dist ? ['--dist'] : [];
const root = resolve('.'), out = join(root, `out/chart-shared/legacy-migration${dist ? '-dist' : ''}`);
const cases = { 'bare-model': runLegacyBareModel,
  'identity-copy-only': context => runLegacyMigrationIdentityCollision(context, true),
  history: runLegacyMigrationHistory, messages: runLegacyMigrationMessages,
  checkpoint: runLegacyMigrationCheckpoint, announcements: runLegacyMigrationAnnouncements,
  limit: runLegacyMigrationTransportLimit, 'early-recovery': runLegacyMigrationEarlyRecovery,
  addresses: runLegacyMigrationAddresses, 'recovery-limit': runLegacyMigrationRecoveryLimit,
  'late-first': runLegacyMigrationLateFirst, constructor: runLegacyMigrationConstructor,
  precopied: runLegacyMigrationPrecopied, disjoint: runLegacyMigrationDisjoint,
  existing: runLegacyMigrationExisting, conflicting: runLegacyMigrationConflicting,
  'concurrent-copy': runLegacyMigrationConcurrentCopy, 'removed-original': runLegacyMigrationRemovedOriginal,
  'custom-identity': runLegacyMigrationCustomIdentity, 'removed-source-slide': runLegacyMigrationRemovedSourceSlide,
  'identity-collision': runLegacyMigrationIdentityCollision, 'removed-copy-chain': runLegacyMigrationRemovedCopyChain,
  'removed-slide-message': runLegacyMigrationRemovedSlideMessage, 'concurrent-removal': runLegacyMigrationConcurrentRemoval,
  'versioned-registers': runVersionedChartRegisters, 'versioned-register-remap': runVersionedChartRegisterRemap,
  'versioned-deferred': runVersionedChartDeferred, 'versioned-opaque-register': runVersionedChartOpaqueRegister,
  'versioned-binding': runVersionedChartBinding, 'core-receipt': runExtensionMigrationReceipt,
  'core-receipt-paths': runExtensionMigrationPaths, 'core-receipt-transport': runExtensionMigrationTransport,
  'core-receipt-deferred': runExtensionMigrationDeferred, 'versioned-conflict': runVersionedChartConflict,
  'migration-recovery-order': runMigrationRecoveryOrder, 'migration-resolver-disposal': runMigrationResolverDisposal,
  'conflict-evidence': runConflictEvidence, 'remote-migration': runRemoteMigration, 'versioned-copy': runChartCopyVersions,
  'versioned-copy-transaction': runChartCopyTransaction, 'versioned-copy-delete': runChartCopyDeletion,
  'versioned-copy-redo': runChartCopyRedo, 'versioned-copy-late': runChartCopyLate,
  'versioned-copy-history': runChartCopyHistorySemantics, 'legacy-shapes': runLegacyChartShapeMatrix };
const resumedCases = { 'checkpoint-resume': resumeLegacyMigrationCheckpoint,
  'announcements-receive': receiveLegacyMigrationAnnouncements, 'early-recovery-resume': resumeLegacyMigrationEarlyRecovery,
  'removed-source-slide-resume': resumeLegacyMigrationRemovedSourceSlide,
  'versioned-registers-resume': resumeVersionedChartRegisters, 'versioned-conflict-resume': resumeVersionedChartConflict,
  'conflict-evidence-resume': resumeConflictEvidence, 'remote-migration-resume': resumeRemoteMigration,
  'versioned-copy-resume': resumeChartCopyVersions, 'versioned-copy-redo-resume': resumeChartCopyRedo,
  'versioned-copy-late-resume': resumeChartCopyLate, 'versioned-copy-remote-restore-resume': resumeChartCopyRemoteRestore,
  'shape-matrix': runLegacyChartShape, 'shape-matrix-cold': resumeLegacyChartShape };
mkdirSync(out, { recursive: true });
const selected = process.argv.find(argument => argument.startsWith('--case='))?.slice(7);
const runtime = join(out, 'runtime.mjs');
const lateRuntime = join(out, 'late-runtime.mjs');
if (selected) {
  const api = ['versioned-conflict-resume', 'conflict-evidence-resume', 'remote-migration-resume', 'versioned-copy-resume', 'versioned-copy-redo-resume', 'versioned-copy-late-resume', 'versioned-copy-remote-restore-resume', 'shape-matrix-cold'].includes(selected) ? (dist ? {
    core: await import('@web-ppt/core'), edit: await import('@web-ppt/edit-core'),
    migration: await import('@web-ppt/collab/migration'), loadShared: () => import('@web-ppt/edit-core/chart-shared'),
  } : await import(pathToFileURL(lateRuntime).href)) : dist ? { core: await import('@web-ppt/core'), edit: await import('@web-ppt/edit-core'),
    basic: await import('@web-ppt/edit-core/chart'), shared: await import('@web-ppt/edit-core/chart-shared'),
    collab: await import('@web-ppt/collab'), migration: await import('@web-ppt/collab/migration') } : await import(pathToFileURL(runtime).href);
  const context = { ...api, assert, input: readFileSync('fixtures/sample-chart-data.pptx'), outputDirectory: out };
  const freshProcess = (name, payload) => {
    writeFileSync(join(out, `${name}-input.json`), JSON.stringify(payload));
    const child = spawnSync(process.execPath, [resolve(import.meta.filename), `--case=${name}`, ...variant],
      { cwd: root, encoding: 'utf8', timeout: 60_000 });
    const output = `${child.stdout ?? ''}${child.stderr ?? ''}`;
    const logName = name.startsWith('shape-matrix') ? `${name}-${payload.name}-${payload.early ? 'early' : 'late'}` : name;
    writeFileSync(join(out, `${logName}.log`), output);
    assert.equal(child.status, 0, `新进程 ${name} 必须通过：\n${output}`);
  };
  if (Object.hasOwn(resumedCases, selected)) {
    await resumedCases[selected]({ ...context, freshProcess }, JSON.parse(readFileSync(join(out, `${selected}-input.json`), 'utf8')));
  } else {
    assert.ok(Object.hasOwn(cases, selected), `未知迁移契约：${selected}`);
    await cases[selected]({ ...context, freshProcess,
      resumeCheckpoint: payload => freshProcess('checkpoint-resume', payload) });
  }
  console.log(`旧局部图表迁移 ${selected} 契约通过`);
} else {
  if (dist) {
    const closure = moduleClosure(join(root, 'packages/collab/dist/collab.js'));
    assert.ok(!closure.source.includes('extensionOperations'), '默认发布入口的全部静态分块不能加载迁移证据实现');
    assert.ok(!closure.files.includes(join(root, 'packages/collab/dist/migration.js')));
  }
  const entry = join(out, 'entry.mjs');
  writeFileSync(entry, `export * as core from '@web-ppt/core';
export * as edit from '@web-ppt/edit-core';
export * as basic from '@web-ppt/edit-core/chart';
export * as shared from '@web-ppt/edit-core/chart-shared';
export * as collab from '@web-ppt/collab';
export * as migration from '@web-ppt/collab/migration';\n`);
  const lateEntry = join(out, 'late-entry.mjs');
  writeFileSync(lateEntry, `export * as core from '@web-ppt/core';\nexport * as edit from '@web-ppt/edit-core';\nexport * as migration from '@web-ppt/collab/migration';\nexport const loadShared = () => import('@web-ppt/edit-core/chart-shared');\n`);
  const aliases = [
    ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
    ['@web-ppt/edit-core', join(root, 'packages/edit-core/src/index.ts')],
    ['@web-ppt/collab', join(root, 'packages/collab/src/index.ts')],
  ];
  if (!dist) {
    await bundleBrowser({ root, entry, output: runtime, aliases });
    await bundleBrowser({ root, entry: lateEntry, output: lateRuntime, aliases });
  }
  // 注册表属于进程；每个契约都必须确实先用普通入口编辑，再加载共享实现。
  const results = Object.keys(cases).map(name => {
    const child = spawnSync(process.execPath, [resolve(import.meta.filename), `--case=${name}`, ...variant],
      { cwd: root, encoding: 'utf8', timeout: 60_000 });
    const output = `${child.stdout ?? ''}${child.stderr ?? ''}`;
    writeFileSync(join(out, `${name}.log`), output);
    console.log(`${name}: ${child.status === 0 ? 'PASS' : 'FAIL'} (${join(out, `${name}.log`)})`);
    return { name, exitCode: child.status, signal: child.signal,
      ...(child.error ? { error: child.error.message } : {}) };
  });
  writeFileSync(join(out, 'result.json'), JSON.stringify(results, null, 2) + '\n');
  if (results.some(result => result.exitCode !== 0)) process.exitCode = 1;
}
