import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse, stringify } from 'smol-toml';

const tools = [
  'ppt_open',
  'ppt_describe',
  'ppt_element',
  'ppt_lint',
  'ppt_render',
  'ppt_edit',
  'ppt_undo',
  'ppt_redo',
  'ppt_save',
  'ppt_close',
];

export async function readUserAgentDefaults(configurationPath) {
  const path = configurationPath ?? join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml');
  const text = await readFile(path, 'utf8');
  let config;
  try {
    config = parse(text, { unsafeKeyBehaviour: 'throw' });
  } catch {
    // 配置可能含认证字段，不把 TOML 解析器的原文片段写入证据。
    throw new Error(`无法解析 Codex 用户配置：${path}`);
  }
  assert(typeof config.model === 'string' && config.model.trim(), 'Codex 用户配置缺少明确 model');
  assert(
    typeof config.model_reasoning_effort === 'string' && config.model_reasoning_effort.trim(),
    'Codex 用户配置缺少明确 model_reasoning_effort',
  );
  return { model: config.model, effort: config.model_reasoning_effort };
}

export async function createCodexInvocation({
  repoRoot,
  experimentDirectory,
  workDirectory,
  evidenceDirectory,
  hostConfigPath,
  model,
  effort,
  timeoutMs,
  codexBin = 'codex',
}) {
  for (const [key, value] of Object.entries({
    repoRoot,
    experimentDirectory,
    workDirectory,
    evidenceDirectory,
    hostConfigPath,
    model,
    effort,
    codexBin,
  })) {
    assert(typeof value === 'string' && value.trim() && value.isWellFormed(), `无效 Codex 配置字段：${key}`);
  }
  assert(Number.isInteger(timeoutMs) && timeoutMs > 0, 'Codex 墙钟预算必须为正整数');
  const helper = join(repoRoot, 'tooling/agent-eval');
  const project = join(workDirectory, '.codex');
  const config = {
    model,
    model_reasoning_effort: effort,
    approval_policy: 'never',
    default_permissions: 'agent_eval',
    features: {
      shell_tool: false,
      multi_agent: false,
      apps: false,
      plugins: false,
      remote_plugin: false,
      browser_use: false,
      browser_use_external: false,
      computer_use: false,
      image_generation: false,
      view_image: false,
      sleep_tool: false,
    },
    permissions: {
      agent_eval: {
        extends: ':read-only',
        filesystem: {
          [helper]: 'deny',
          [experimentDirectory]: 'deny',
          [evidenceDirectory]: 'deny',
          [project]: 'deny',
        },
      },
    },
    mcp_servers: {
      ppt_eval: {
        command: process.execPath,
        args: [join(helper, 'host.mjs'), '--config', hostConfigPath],
        cwd: workDirectory,
        enabled_tools: tools,
        default_tools_approval_mode: 'prompt',
        // 用户已授权合成文稿的这些操作；只批准白名单工具，不改变全局审批或文件权限。
        tools: Object.fromEntries(tools.map((name) => [name, { approval_mode: 'approve' }])),
        startup_timeout_sec: 30,
        tool_timeout_sec: Math.ceil(timeoutMs / 1000),
      },
    },
  };
  const text = stringify(config);
  assert.deepEqual(JSON.parse(JSON.stringify(parse(text, { unsafeKeyBehaviour: 'throw' }))), config, 'Codex 完整配置 TOML 必须可无损重开');
  await mkdir(project, { recursive: true });
  const configPath = join(project, 'config.toml');
  await writeFile(configPath, text, { flag: 'wx' });
  // CLI dotted-key 会错误切分含点路径；顶层 projects 表只信任本次生成的配置。
  const trust = `projects={${JSON.stringify(resolve(workDirectory))}={trust_level="trusted"}}`;
  assert.deepEqual(JSON.parse(JSON.stringify(parse(trust, { unsafeKeyBehaviour: 'throw' }))), {
    projects: { [resolve(workDirectory)]: { trust_level: 'trusted' } },
  });
  return {
    command: codexBin,
    args: [
      'exec',
      '--ignore-user-config',
      '--strict-config',
      '--ephemeral',
      '--json',
      '--color',
      'never',
      '-C',
      workDirectory,
      '-c',
      trust,
      '-m',
      model,
      '-c',
      `model_reasoning_effort=${JSON.stringify(effort)}`,
      '-o',
      join(evidenceDirectory, 'final-message.txt'),
      '-',
    ],
    configPath,
    config,
    trustOverride: trust,
  };
}
