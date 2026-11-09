import { createHash } from 'node:crypto';
import { MIGRATION_SHARDS, MIGRATION_SCRIPT } from './migration-shards.mjs';

export const EQUIVALENCE_SHARDS = 4;
export const SOURCE_GROUPS = Object.freeze([
  'saving', 'editing', 'integration', 'browser-unit', 'browser', 'agent', 'expanded', 'render', 'charts',
  ...Array.from({ length: MIGRATION_SHARDS }, (_, index) => `migration-${index}`),
  ...Array.from({ length: EQUIVALENCE_SHARDS }, (_, index) => `equivalence-${index}`),
]);
export const DIST_GROUPS = Object.freeze(['base', 'agent', 'expanded', 'render', 'charts',
  ...Array.from({ length: MIGRATION_SHARDS }, (_, index) => `migration-${index}`),
]);
// office：LibreOffice 真实打开；ooxml：XSD + Open XML SDK 双通道。两者都只读取其他分组落盘的保存产物。
export const EXTERNAL_GROUPS = Object.freeze(['office', 'ooxml']);

export function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function groupsForPhase(phase) {
  if (phase === 'source') return SOURCE_GROUPS;
  if (phase === 'dist') return DIST_GROUPS;
  if (phase === 'external') return EXTERNAL_GROUPS;
  throw new Error(`未知 CI 阶段 ${phase}；预期 source、dist 或 external`);
}

// 这里只接受仓库门禁实际使用的命令模型；遇到 shell 扩展必须先明确扩展模型。
export function parseCommandChain(source, script) {
  if (typeof source !== 'string' || !source.trim()) throw new Error(`npm script ${script} 为空`);
  return source.split('&&').map((part) => {
    const argv = part.trim().split(/\s+/);
    if (argv.some((token) => !/^[A-Za-z0-9_./:@=,+%-]+$/.test(token))) {
      throw new Error(`npm script ${script} 含不支持的 shell 语法：${part.trim()}`);
    }
    if (argv[0] === 'npm' && argv.length === 3 && argv[1] === 'run') return { script: argv[2] };
    if (!['node', 'python3'].includes(argv[0]) || argv.length < 2) {
      throw new Error(`npm script ${script} 含不支持的命令：${part.trim()}`);
    }
    return { executable: argv[0], args: argv.slice(1), command: argv.join(' ') };
  });
}

export function expandScript(scripts, entry) {
  const leaves = [];
  function body(name, ancestors, active) {
    if (!Object.hasOwn(scripts, name)) throw new Error(`npm script ${name} 不存在（${ancestors.join(' → ')}）`);
    if (active.includes(name)) throw new Error(`npm script 循环调用：${[...active, name].join(' → ')}`);
    const ancestry = [...ancestors, name];
    for (const command of parseCommandChain(scripts[name], name)) {
      if (command.script) invocation(command.script, ancestry, [...active, name]);
      else leaves.push({ ...command, ancestry });
    }
  }
  function invocation(name, ancestors, active) {
    // npm 调用生命周期 hook 时不会再次隐式调用 hook 自身的 pre/post。
    for (const hook of [`pre${name}`, name, `post${name}`]) {
      if (hook === name || Object.hasOwn(scripts, hook)) body(hook, hook === name ? ancestors : [...ancestors, name], active);
    }
  }
  invocation(entry, [], []);
  const commands = new Set();
  return leaves.map((leaf, index) => {
    if (commands.has(leaf.command)) throw new Error(`唯一门禁重复执行命令：${leaf.command}`);
    commands.add(leaf.command);
    return { id: index, ...leaf };
  });
}

function groupForLeaf(leaf, phase) {
  const from = (...scripts) => scripts.some((script) => leaf.ancestry.includes(script));
  if (phase === 'external') return from('test:ci:ooxml') ? 'ooxml' : 'office';
  if (leaf.executable === 'node' && leaf.args.includes(MIGRATION_SCRIPT)) return 'migration';
  if (phase === 'source' && leaf.command === 'node tooling/test-edit-save.mjs') return 'saving';
  if (phase === 'source' && ['node tooling/test-design-journey.mjs', 'node tooling/collect-chart-media-office-artifacts.mjs'].includes(leaf.command)) return 'integration';
  if (phase === 'source' && from('pretest:functional')) return 'agent';
  if (phase === 'dist' && from('postverify')) return 'agent';
  if (phase === 'source' && leaf.args.includes('tooling/test-edit-equivalence.mjs')) return 'equivalence';
  if (phase === 'source' && from('test:editor:functional')) {
    return leaf.command === 'node tooling/test-site-editor-browser.mjs' ? 'browser' : 'browser-unit';
  }
  if (from('test:expanded', 'test:expanded:dist', 'test:portability', 'test:portability:dist')) return 'expanded';
  if (from('test:chart-hierarchy', 'test:chart-hierarchy:dist', 'test:chart-shared', 'test:chart-shared:dist')) return 'charts';
  // 动画统一验收在真实 Chrome 里断言 painted 几何，需要与渲染组相同的中文字体环境
  if (from('test:fonts', 'test:fonts:dist', 'test:pdf:vector', 'test:pdf:vector:dist', 'test:animation', 'test:animation:dist')
    || leaf.args.some((arg) => /^tooling\/test-(?:video-audio|video-overlay|agent-node-render|agent-node-render-parity)\.mjs$/.test(arg))) return 'render';
  return phase === 'source' ? 'editing' : 'base';
}

export function createPlan(scripts, phase) {
  const groups = Object.fromEntries(groupsForPhase(phase).map((group) => [group, []]));
  const entry = { source: 'test:functional', dist: 'verify', external: 'test:ci:external' }[phase];
  const leaves = expandScript(scripts, entry);
  for (const leaf of leaves) {
    const group = groupForLeaf(leaf, phase);
    const shards = shardCountForLeaf(leaf, phase);
    if (shards === 1) groups[group].push(leaf);
    else for (let index = 0; index < shards; index++) {
      groups[`${group}-${index}`].push({
        ...leaf, shard: { index, total: shards },
        args: [...leaf.args, '--shard-index', String(index), '--shard-count', String(shards)],
      });
    }
  }
  return { phase, leaves, groups };
}

export function shardCountForLeaf(leaf, phase) {
  const group = groupForLeaf(leaf, phase);
  return group === 'equivalence' ? EQUIVALENCE_SHARDS : group === 'migration' ? MIGRATION_SHARDS : 1;
}

export function groupPlan(scripts, phase, group) {
  const plan = createPlan(scripts, phase);
  if (!Object.hasOwn(plan.groups, group)) throw new Error(`未知 ${phase} CI 分组 ${group}`);
  return { version: 1, phase, group, commands: plan.groups[group] };
}

export function partitionFixtures(fixtures, index, total) {
  if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || index < 0 || index >= total) {
    throw new Error(`无效固件分片 ${index}/${total}；要求 0 ≤ index < count`);
  }
  return fixtures.filter((_, position) => position % total === index);
}
