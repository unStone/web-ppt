/**
 * 独立校验 PowerPoint COM 门禁证据。
 *
 * COM 脚本和校验器刻意用两种语言实现：前者负责观察 PowerPoint，后者重新读取
 * 当前清单与磁盘字节，避免脚本把“自己声称成功”当成证明。
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

const MAX_AGE_MS = 60 * 60_000;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

const args = process.argv.slice(2);
const valueOf = (name) => {
  const at = args.indexOf(name);
  if (at < 0 || at === args.length - 1 || args[at + 1].startsWith('--')) {
    throw new Error(`缺少 ${name} 参数`);
  }
  return args[at + 1];
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const parseJson = (path, label) => {
  const bytes = readFileSync(path);
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')) };
  } catch (error) {
    throw new Error(`${label} 不是合法 JSON：${error.message}`);
  }
};

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isPositiveInt = (value) => Number.isInteger(value) && value > 0;
const requireString = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} 缺失`);
  return value;
};

const resolveArtifact = (manifestPath, file) => {
  if (typeof file !== 'string' || file === '' || file.includes('/') || file.includes('\\')) {
    throw new Error(`清单产物路径必须是同目录文件名：${String(file)}`);
  }
  const base = resolve(dirname(manifestPath));
  const path = resolve(base, file);
  if (!path.startsWith(`${base}${sep}`)) throw new Error(`清单产物越过证据目录：${file}`);
  return path;
};

const validate = () => {
  const manifestPath = resolve(valueOf('--manifest'));
  const reportPath = resolve(valueOf('--report'));
  const manifestJson = parseJson(manifestPath, 'Office 清单');
  const reportJson = parseJson(reportPath, 'PowerPoint 报告');
  const manifest = manifestJson.value;
  const report = reportJson.value;

  if (!isRecord(manifest) || manifest.version !== 1
    || !Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    throw new Error('Office 清单格式无效');
  }
  if (!isRecord(report) || report.version !== 1) throw new Error('PowerPoint 报告格式无效');
  if (report.passed !== true) {
    throw new Error(`PowerPoint 门禁未通过：${report.failure || '未提供失败原因'}`);
  }
  if (report.failure !== null && report.failure !== '') {
    throw new Error(`PowerPoint 成功报告仍含失败原因：${String(report.failure)}`);
  }

  const generatedAt = Date.parse(report.generatedAt);
  if (!Number.isFinite(generatedAt)) throw new Error('PowerPoint 报告 generatedAt 无效');
  const age = Date.now() - generatedAt;
  if (age > MAX_AGE_MS) throw new Error(`PowerPoint 报告已过期：${Math.round(age / 60_000)} 分钟`);
  if (age < -MAX_CLOCK_SKEW_MS) throw new Error('PowerPoint 报告时间晚于当前机器超过 5 分钟');

  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    cwd: new URL('..', import.meta.url),
  }).trim();
  if (report.sourceRevision !== revision) {
    throw new Error(`PowerPoint 报告属于 ${String(report.sourceRevision)}，当前源码为 ${revision}`);
  }
  if (report.manifestSha256 !== sha256(manifestJson.bytes)) {
    throw new Error('PowerPoint 报告绑定的清单 SHA-256 与当前清单不一致');
  }

  if (!isRecord(report.powerPoint)) throw new Error('PowerPoint 版本信息缺失');
  requireString(report.powerPoint.version, 'PowerPoint version');
  requireString(report.powerPoint.build, 'PowerPoint build');
  if (!isRecord(report.environment) || report.environment.userInteractive !== true
    || !isPositiveInt(report.environment.sessionId)) {
    throw new Error('PowerPoint 门禁必须运行在已登录的交互式 Windows 桌面会话');
  }
  if (!Array.isArray(report.artifacts)) throw new Error('PowerPoint 报告产物列表缺失');

  const expectedFiles = new Set();
  const reportsByFile = new Map();
  for (const entry of report.artifacts) {
    if (!isRecord(entry) || typeof entry.file !== 'string' || reportsByFile.has(entry.file)) {
      throw new Error(`PowerPoint 报告含无效或重复产物：${String(entry?.file)}`);
    }
    reportsByFile.set(entry.file, entry);
  }

  for (const artifact of manifest.artifacts) {
    if (!isRecord(artifact) || typeof artifact.file !== 'string'
      || !isPositiveInt(artifact.slides) || expectedFiles.has(artifact.file)) {
      throw new Error(`Office 清单含无效或重复产物：${String(artifact?.file)}`);
    }
    expectedFiles.add(artifact.file);
    const evidence = reportsByFile.get(artifact.file);
    if (!evidence) throw new Error(`PowerPoint 报告漏验清单产物：${artifact.file}`);
    const actualHash = sha256(readFileSync(resolveArtifact(manifestPath, artifact.file)));
    if (evidence.sha256 !== actualHash) {
      throw new Error(`${artifact.file} 的 SHA-256 与 PowerPoint 打开时不同`);
    }
    if (evidence.expectedSlides !== artifact.slides || evidence.actualSlides !== artifact.slides) {
      throw new Error(`${artifact.file} 页数证据不一致`);
    }
    if (evidence.openedWithoutRepair !== true) {
      throw new Error(`${artifact.file} 没有“未修复打开”的成功证据`);
    }
  }
  if (reportsByFile.size !== expectedFiles.size) {
    throw new Error('PowerPoint 报告包含清单之外的产物');
  }

  console.log(`PowerPoint 证据有效：${expectedFiles.size}/${expectedFiles.size} 份，版本 ${report.powerPoint.version} build ${report.powerPoint.build}`);
};

try {
  validate();
} catch (error) {
  console.error(`PowerPoint 证据无效：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
