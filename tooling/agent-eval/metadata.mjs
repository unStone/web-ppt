import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';

const exec = promisify(execFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export function implementationFingerprint({ files, packages, dependencyLocks }) {
  return sha(JSON.stringify({ files, packages, dependencyLocks }));
}

async function sourceFiles(root, directory, files = {}, extensions = ['.mjs']) {
  for (const name of (await readdir(directory)).sort()) {
    if (name === 'records' || name === 'fixtures') continue;
    const path = join(directory, name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`实现目录不接受符号链接：${path}`);
    if (stat.isDirectory()) await sourceFiles(root, path, files, extensions);
    else if (extensions.some(extension => name.endsWith(extension))) files[relative(root, path)] = sha(await readFile(path));
  }
  return files;
}

export async function captureImplementation(repoRoot) {
  const files = await sourceFiles(repoRoot, join(repoRoot, 'tooling/agent-eval'));
  for (const path of ['package.json', 'package-lock.json', 'tooling/template-fill-fonts/manifest.json',
    'tooling/template-fill-fonts/regular.ttf', 'tooling/template-fill-fonts/bold.ttf',
    'packages/agent-mcp/skills/web-ppt/SKILL.md']) {
    files[path] = sha(await readFile(join(repoRoot, path)));
  }
  const lock = JSON.parse(await readFile(join(repoRoot, 'package-lock.json'), 'utf8'));
  const dependencyLocks = {};
  for (const name of ['@modelcontextprotocol/sdk', 'harfbuzzjs', 'culori', 'smol-toml', '@resvg/resvg-js']) {
    const key = `node_modules/${name}`;
    const entry = lock.packages?.[key];
    assert(typeof entry?.version === 'string' && entry.version,
      `package-lock.json缺少评测依赖版本：${name}`);
    dependencyLocks[name] = { version: entry.version, resolved: entry.resolved,
      integrity: entry.integrity, source: `package-lock.json#packages[${JSON.stringify(key)}]` };
  }
  const runtime = { node: process.version, platform: process.platform, arch: process.arch };
  const packages = {};
  for (const name of ['core', 'edit-core', 'fonts', 'agent-mcp']) {
    const path = fileURLToPath(import.meta.resolve(`@web-ppt/${name}/package.json`));
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    packages[manifest.name] = { version: manifest.version, manifestSha256: sha(await readFile(path)),
      entrySha256: sha(await readFile(join(dirname(path), manifest.main))),
      distFiles: await sourceFiles(dirname(path), join(dirname(path), 'dist'), {}, ['.js', '.wasm']) };
  }
  const { stdout: commit } = await exec('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
  const { stdout: status } = await exec('git', ['status', '--porcelain=v1'], { cwd: repoRoot });
  const instructionFiles = {};
  const instructionPaths = { project: join(repoRoot, 'AGENTS.md'),
    user: join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'AGENTS.md'),
    router: join(homedir(), '.agents/AGENTS.md') };
  for (const [role, path] of Object.entries(instructionPaths)) {
    try {
      instructionFiles[role] = sha(await readFile(path));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      instructionFiles[role] = null;
    }
  }
  return { commit: commit.trim(), dirty: Boolean(status.trim()), files, packages, instructionFiles,
    dependencyLocks, runtime, contextFingerprint: sha(JSON.stringify(instructionFiles)),
    fingerprint: implementationFingerprint({ files, packages, dependencyLocks }) };
}

export function agentEnvironment(source = process.env) {
  const allowed = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP',
    'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'SYSTEMROOT',
    'COMSPEC', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY',
    'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'SSL_CERT_FILE',
    'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS', 'CODEX_HOME'];
  return Object.fromEntries(allowed.filter(key => typeof source[key] === 'string').map(key => [key, source[key]]));
}

export async function readCodexVersion(codexBin, env = agentEnvironment()) {
  const { stdout, stderr } = await exec(codexBin, ['--version'], { timeout: 10000, env });
  const version = `${stdout}${stderr}`.trim();
  if (!/^codex-cli\s+\S+/.test(version)) throw new Error(`Agent CLI 身份不是 Codex：${version}`);
  return version;
}

export async function inspectCodex(codexBin, env = agentEnvironment()) {
  const version = await readCodexVersion(codexBin, env);
  const login = await exec(codexBin, ['login', 'status'], { timeout: 10000, env });
  const text = `${login.stdout}${login.stderr}`;
  if (!/logged in/i.test(text)) throw new Error('Codex CLI 未报告已登录，不能开始真实模型评测');
  return { version, authentication: /ChatGPT/i.test(text) ? 'ChatGPT' : 'configured-credential' };
}
