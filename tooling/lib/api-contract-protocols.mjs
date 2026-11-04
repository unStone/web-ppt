import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

export const PUBLIC_PROTOCOLS = [
  { specifier: '@web-ppt/edit-core', symbol: 'EDITOR_RECOVERY_VERSION' },
  { specifier: '@web-ppt/edit-core', symbol: 'RecoveryFrame', property: 'version', sameAs: 'EDITOR_RECOVERY_VERSION' },
  { specifier: '@web-ppt/edit-core', symbol: 'ElementClipboardPayload', property: 'version' },
  { specifier: '@web-ppt/edit-core', symbol: 'ExtensionMigrationReceipt', property: 'version' },
  { specifier: '@web-ppt/editor', symbol: 'RecoveryStoreJournal', property: 'version' },
  { specifier: '@web-ppt/collab', symbol: 'CollabMessage', property: 'version' },
  { specifier: '@web-ppt/collab', symbol: 'CollaborationCheckpoint', property: 'version' },
  { specifier: '@web-ppt/edit-core/describe', symbol: 'PresentationDescription', property: 'version',
    schema: '@web-ppt/edit-core/describe/schema.json' },
  { specifier: '@web-ppt/edit-core/lint', symbol: 'LayoutLintReport', property: 'version',
    schema: '@web-ppt/edit-core/lint/schema.json' },
  { specifier: '@web-ppt/edit-core/fill', symbol: 'TemplateFillOutline', property: 'version',
    schema: '@web-ppt/edit-core/fill/schema.json' },
];

const portable = path => path.replaceAll('\\', '/');
const label = descriptor => `${descriptor.symbol}${descriptor.property ? `.${descriptor.property}` : ''}`;

export function readProtocolVersions(root, packages, { protocols = PUBLIC_PROTOCOLS, dist = false } = {}) {
  const configPath = join(root, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(`API 协议无法读取 TypeScript 配置：${configPath}`);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  if (parsed.errors.length) throw new Error(`API 协议 TypeScript 配置无效：${ts.flattenDiagnosticMessageText(parsed.errors[0].messageText, '\n')}`);
  const entries = new Map();
  for (const descriptor of protocols) {
    if (entries.has(descriptor.specifier)) continue;
    const pkg = packages.find(pkg => descriptor.specifier === pkg.name || descriptor.specifier.startsWith(`${pkg.name}/`));
    if (!pkg) throw new Error(`API 协议缺少公开包：${descriptor.specifier}`);
    let target;
    if (dist) {
      const subpath = descriptor.specifier === pkg.name ? '.' : `.${descriptor.specifier.slice(pkg.name.length)}`;
      const exported = pkg.exports.find(entry => entry.subpath === subpath);
      target = exported?.resolution.conditions?.find(entry => entry.condition === 'types')?.resolution;
    } else {
      const paths = parsed.options.paths?.[descriptor.specifier];
      if (paths?.length === 1) target = portable(relative(join(root, pkg.directory), resolve(root, paths[0])));
    }
    if (typeof target !== 'string') throw new Error(`API 协议缺少唯一 ${dist ? 'types 导出' : '源码 paths 映射'}：${descriptor.specifier}`);
    entries.set(descriptor.specifier, resolve(root, pkg.directory, target));
  }
  const compilerOptions = { ...parsed.options, noEmit: true };
  // 产物模式按 npm workspace 的声明解析，不能被源码 paths 偷换。
  if (dist) delete compilerOptions.paths;
  const program = ts.createProgram([...entries.values()], compilerOptions);
  const checker = program.getTypeChecker();
  const records = protocols.map(descriptor => {
    const entry = program.getSourceFile(entries.get(descriptor.specifier));
    const module = entry && checker.getSymbolAtLocation(entry);
    let symbol = module && checker.getExportsOfModule(module).find(symbol => symbol.name === descriptor.symbol);
    if (!symbol) throw new Error(`API 协议没有公开导出：${descriptor.specifier} / ${descriptor.symbol}`);
    if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
    let type;
    if (descriptor.property) {
      const property = checker.getDeclaredTypeOfSymbol(symbol).getProperty(descriptor.property);
      if (property) type = checker.getTypeOfSymbolAtLocation(property, property.valueDeclaration ?? declaration);
    } else type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
    if (!type || !(type.flags & ts.TypeFlags.NumberLiteral) || !Number.isSafeInteger(type.value) || type.value < 1) {
      throw new Error(`API 协议 ${descriptor.specifier} / ${label(descriptor)} 预期正整数字面量，实际 ${type ? checker.typeToString(type) : '缺失'}`);
    }
    return { specifier: descriptor.specifier, symbol: descriptor.symbol,
      ...(descriptor.property ? { property: descriptor.property } : {}),
      version: type.value, source: portable(relative(root, declaration.getSourceFile().fileName)) };
  });
  for (const descriptor of protocols) {
    const record = records.find(record => record.specifier === descriptor.specifier && record.symbol === descriptor.symbol);
    if (descriptor.sameAs) {
      const constant = records.find(record => record.specifier === descriptor.specifier && record.symbol === descriptor.sameAs);
      if (!constant || constant.version !== record.version) throw new Error(`API 协议版本不一致：${label(descriptor)}=${record.version}，${descriptor.sameAs}=${constant?.version}`);
    }
    if (descriptor.schema) {
      const pkg = packages.find(pkg => descriptor.schema.startsWith(`${pkg.name}/`));
      const subpath = `.${descriptor.schema.slice(pkg.name.length)}`;
      const target = pkg.exports.find(entry => entry.subpath === subpath)?.resolution;
      if (typeof target !== 'string') throw new Error(`API 协议缺少 Schema 直接导出：${descriptor.schema}`);
      const schema = JSON.parse(readFileSync(join(root, pkg.directory, target), 'utf8'));
      const version = schema.definitions?.[descriptor.symbol]?.properties?.[descriptor.property]?.const;
      if (version !== record.version) throw new Error(`API 协议与 Schema 版本不一致：${label(descriptor)}=${record.version}，${descriptor.schema}=${version}`);
    }
  }
  return records.sort((a, b) => `${a.specifier}/${a.symbol}`.localeCompare(`${b.specifier}/${b.symbol}`));
}
