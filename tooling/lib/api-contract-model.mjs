import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import mapWorkspaces from '@npmcli/map-workspaces';
import Ajv from 'ajv';
import ts from 'typescript';
import { PUBLIC_PROTOCOLS, readProtocolVersions } from './api-contract-protocols.mjs';
import { auditPublishedTemplateBinaries } from './published-template-binaries.mjs';

const portable = path => path.replaceAll('\\', '/');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const digest = content => createHash('sha256').update(content).digest('hex');
const sorted = value => Array.isArray(value) ? value.map(sorted)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
export const canonicalJson = value => JSON.stringify(sorted(value));

function safeTarget(directory, target) {
  if (typeof target !== 'string' || !target.startsWith('./') || target.includes('*') || target.includes('\\')) {
    throw new Error(`API 导出路径无效：${directory} / ${target}；预期明确的 ./ 相对文件路径`);
  }
  const path = resolve(directory, target), local = relative(directory, path);
  if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) throw new Error(`API 导出越出包目录：${directory} / ${target}`);
  return path;
}

function resolution(directory, value) {
  if (value === null) return null;
  if (typeof value === 'string') { safeTarget(directory, value); return value; }
  if (Array.isArray(value)) return { fallbacks: value.map(entry => resolution(directory, entry)) };
  if (!value || typeof value !== 'object' || !Object.keys(value).length) throw new Error(`API exports 条件无效：${directory}`);
  // 条件顺序影响 Node 选择分支，转成数组后不会被 JSON 规范化排序抹去。
  return { conditions: Object.entries(value).map(([condition, target]) => ({ condition, resolution: resolution(directory, target) })) };
}

function leaves(value) {
  if (value === null) return [];
  if (typeof value === 'string') return [value];
  return value.fallbacks ? value.fallbacks.flatMap(leaves) : value.conditions.flatMap(({ resolution }) => leaves(resolution));
}

function resourceFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`API Skill 资源不允许符号链接：${path}`);
    if (entry.isDirectory()) return resourceFiles(path);
    if (!entry.isFile()) throw new Error(`API Skill 资源不是文件：${path}`);
    return [path];
  });
}

export async function collectApiContract(directory, { protocols = PUBLIC_PROTOCOLS } = {}) {
  const root = resolve(directory), manifest = json(join(root, 'package.json'));
  const workspaces = await mapWorkspaces({ cwd: root, pkg: manifest });
  const packages = [], schemas = [], resources = [];
  const ajv = new Ajv({ strict: false });
  for (const [name, directory] of [...workspaces].sort(([a], [b]) => a.localeCompare(b))) {
    const path = resolve(directory), pkg = json(join(path, 'package.json'));
    if (pkg.name !== name || pkg.private !== undefined && typeof pkg.private !== 'boolean') throw new Error(`API workspace 声明无效：${path}`);
    if (pkg.private === true) continue;
    if (!pkg.exports || typeof pkg.exports !== 'object' || Array.isArray(pkg.exports)) throw new Error(`API 公开包缺少 exports 子路径表：${name}`);
    const exports = Object.entries(pkg.exports).sort(([a], [b]) => a.localeCompare(b)).map(([subpath, value]) => {
      if (subpath !== '.' && !subpath.startsWith('./') || subpath.includes('*')) throw new Error(`API exports 子路径无效：${name} / ${subpath}`);
      return { subpath, resolution: resolution(path, value) };
    });
    if (!exports.length) throw new Error(`API 公开包 exports 为空：${name}`);
    const bin = pkg.bin === undefined ? {} : typeof pkg.bin === 'string' ? { [name.slice(name.lastIndexOf('/') + 1)]: pkg.bin } : pkg.bin;
    if (!bin || typeof bin !== 'object' || Array.isArray(bin)) throw new Error(`API CLI 声明无效：${name}`);
    for (const target of Object.values(bin)) safeTarget(path, target);
    packages.push({ name, directory: portable(relative(root, path)), type: pkg.type ?? 'commonjs', exports, bin });
    for (const entry of exports) for (const target of [...new Set(leaves(entry.resolution))]) {
      if (extname(target) !== '.json' || target === './package.json') continue;
      const schema = json(safeTarget(path, target));
      if (typeof schema?.$schema !== 'string' || !ajv.validateSchema(schema)) throw new Error(`API JSON Schema 无效：${name}${entry.subpath.slice(1)} / ${target}`);
      schemas.push({ specifier: `${name}${entry.subpath.slice(1)}`, target,
        dialect: schema.$schema, id: schema.$id ?? null, sha256: digest(canonicalJson(schema)) });
    }
    for (const resource of resourceFiles(join(path, 'skills'))) {
      if (!pkg.files?.includes('skills')) throw new Error(`API Skill 资源未声明发布：${name} / ${resource}`);
      resources.push({ package: name, target: `./${portable(relative(path, resource))}`, sha256: digest(readFileSync(resource)) });
    }
  }
  if (!packages.length) throw new Error(`API 候选清单没有公开 workspace：${root}`);
  return { formatVersion: 1, phase: 'candidate', packages, schemas, resources,
    protocols: readProtocolVersions(root, packages, { protocols }) };
}

function firstDifference(expected, actual, path = '$') {
  if (canonicalJson(expected) === canonicalJson(actual)) return null;
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    for (const key of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
      const difference = firstDifference(expected[key], actual[key], `${path}.${key}`);
      if (difference) return difference;
    }
  }
  return { path, expected, actual };
}

export function assertApiContract(expected, actual) {
  const difference = firstDifference(expected, actual);
  if (difference) throw new Error(`API 候选清单漂移：${difference.path}；预期 ${JSON.stringify(difference.expected)?.slice(0, 180)}，实际 ${JSON.stringify(difference.actual)?.slice(0, 180)}。核对迁移说明后显式运行 node tooling/check-api-contract.mjs --write`);
}

function checkFile(path) {
  if (!existsSync(path) || !lstatSync(path).isFile()) throw new Error(`API 发布产物缺失或不是普通文件：${path}`);
  const content = readFileSync(path, 'utf8');
  if (!content.trim()) throw new Error(`API 发布产物为空：${path}`);
  if (extname(path) === '.json') json(path);
  if (extname(path) === '.js' || extname(path) === '.ts') {
    const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true,
      extname(path) === '.js' ? ts.ScriptKind.JS : ts.ScriptKind.TS);
    if (source.parseDiagnostics.length) throw new Error(`API 发布产物语法无效：${path}；${ts.flattenDiagnosticMessageText(source.parseDiagnostics[0].messageText, '\n')}`);
  }
}

export async function checkApiArtifacts(directory, contract, { protocols = PUBLIC_PROTOCOLS } = {}) {
  const root = resolve(directory);
  for (const pkg of contract.packages) {
    const path = join(root, pkg.directory);
    for (const target of new Set([...pkg.exports.flatMap(entry => leaves(entry.resolution)), ...Object.values(pkg.bin)])) checkFile(safeTarget(path, target));
  }
  for (const resource of contract.resources) {
    const pkg = contract.packages.find(pkg => pkg.name === resource.package);
    const path = safeTarget(join(root, pkg.directory), resource.target);
    checkFile(path);
    if (digest(readFileSync(path)) !== resource.sha256) throw new Error(`API 发布 Skill 与候选内容不一致：${resource.package} / ${resource.target}`);
  }
  for (const schema of contract.schemas) {
    const pkg = contract.packages.find(pkg => schema.specifier.startsWith(`${pkg.name}/`));
    const path = safeTarget(join(root, pkg.directory), schema.target);
    if (digest(canonicalJson(json(path))) !== schema.sha256) throw new Error(`API 发布 Schema 与候选内容不一致：${schema.specifier}`);
  }
  const published = await auditPublishedTemplateBinaries(root);
  for (const pkg of contract.packages) {
    const files = new Set(published.find(entry => entry.name === pkg.name)?.files);
    const targets = [...pkg.exports.flatMap(entry => leaves(entry.resolution)), ...Object.values(pkg.bin),
      ...contract.resources.filter(resource => resource.package === pkg.name).map(resource => resource.target)];
    for (const target of targets) {
      const file = portable(relative(join(root, pkg.directory), safeTarget(join(root, pkg.directory), target)));
      if (!files.has(file)) throw new Error(`npm 发布清单缺少 API 目标：${pkg.name} / ${file}；检查 files 与忽略规则`);
    }
  }
  const actual = readProtocolVersions(root, contract.packages, { protocols, dist: true });
  for (const expected of contract.protocols) {
    const record = actual.find(record => record.specifier === expected.specifier && record.symbol === expected.symbol);
    if (!record || record.version !== expected.version) throw new Error(`API 发布协议 ${expected.symbol}${expected.property ? `.${expected.property}` : ''} 实际 ${record?.version}，预期 ${expected.version}`);
    if (record.source !== expected.source.replace('/src/', '/dist/').replace(/\.ts$/, '.d.ts')) throw new Error(`API 发布协议意外解析到其他声明：${expected.symbol} / ${record.source}`);
  }
}
