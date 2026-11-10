import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';

export class EvaluationHostError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'EvaluationHostError';
    this.reason = reason;
  }
}

const fail = (message) => {
  throw new EvaluationHostError('eval-path-not-allowed', message);
};
const inside = (base, path) => {
  const difference = relative(base, path);
  return difference !== '' && difference !== '..' && !difference.startsWith(`..${sep}`) && !isAbsolute(difference);
};

async function canonicalFile(path, { required = false } = {}) {
  const parent = await realpath(dirname(path));
  const canonical = resolve(parent, basename(path));
  let info;
  try {
    info = await lstat(canonical);
  } catch (error) {
    if (error.code !== 'ENOENT' || required) throw error;
    return canonical;
  }
  if (info.isSymbolicLink()) fail(`评测文件不接受符号链接：${path}`);
  if (!info.isFile()) fail(`评测路径必须是普通文件：${path}`);
  return realpath(canonical);
}

export async function createPathPolicy(config) {
  const keys = ['version', 'condition', 'inputPath', 'outputPath', 'renderDirectory', 'protocolPath', 'maxCalls'];
  if (
    !config
    || typeof config !== 'object'
    || Array.isArray(config)
    || Object.keys(config).some((key) => !keys.includes(key))
    || keys.some((key) => !Object.hasOwn(config, key))
  ) {
    throw new EvaluationHostError('eval-invalid-config', `host 配置必须且仅包含 ${keys.join(', ')}`);
  }
  if (
    config.version !== 1
    || !['with-lint', 'without-lint'].includes(config.condition)
    || !Number.isSafeInteger(config.maxCalls)
    || config.maxCalls < 1
    || config.maxCalls > 10000
  ) {
    throw new EvaluationHostError('eval-invalid-config', 'host 需要 version=1、有效 condition 和 1–10000 的 maxCalls');
  }
  for (const key of ['inputPath', 'outputPath', 'renderDirectory', 'protocolPath']) {
    if (typeof config[key] !== 'string' || !isAbsolute(config[key])) {
      throw new EvaluationHostError('eval-invalid-config', `${key} 必须是绝对本地路径，收到 ${String(config[key])}`);
    }
  }
  const inputPath = await canonicalFile(config.inputPath, { required: true });
  const outputPath = await canonicalFile(config.outputPath);
  const protocolPath = await canonicalFile(config.protocolPath);
  const workspace = dirname(inputPath);
  const renderDirectory = await realpath(config.renderDirectory);
  if (inputPath === outputPath || [inputPath, outputPath].includes(protocolPath)) {
    throw new EvaluationHostError('eval-invalid-config', '输入、输出与协议文件必须相互独立');
  }
  if (!(await lstat(renderDirectory)).isDirectory() || !inside(workspace, renderDirectory)) {
    throw new EvaluationHostError('eval-invalid-config', 'renderDirectory 必须是输入工作目录中的独立子目录');
  }

  const resolveRequested = async (value) => {
    if (typeof value !== 'string' || !value.trim() || (!isAbsolute(value) && URL.canParse(value))) {
      fail(`只允许评测本地文件路径，收到 ${String(value)}`);
    }
    try {
      return await canonicalFile(resolve(workspace, value));
    } catch (error) {
      if (error instanceof EvaluationHostError) throw error;
      fail(`无法确认评测路径 ${value}：${error.message}`);
    }
  };
  return {
    inputPath,
    outputPath,
    protocolPath,
    renderDirectory,
    workspace,
    async validate(name, args) {
      if (name === 'ppt_open') {
        const path = await resolveRequested(args.path);
        if (path !== inputPath && path !== outputPath) fail(`ppt_open 仅允许本次输入或输出：${path}`);
      }
      if (name === 'ppt_save') {
        const path = await resolveRequested(args.path);
        if (path !== outputPath) fail(`ppt_save 仅允许 ${outputPath}，收到 ${path}`);
      }
      if (name === 'ppt_render' && args.path !== undefined) {
        const path = await resolveRequested(args.path);
        if (!inside(renderDirectory, path) || extname(path) !== `.${args.format}`) {
          fail(`ppt_render 仅允许本次 renderDirectory 内匹配格式的文件：${path}`);
        }
      }
    },
    async savedPath(value) {
      const path = await resolveRequested(value);
      if (path !== outputPath) fail(`保存结果未指向本次输出：${path}`);
      return path;
    },
  };
}
