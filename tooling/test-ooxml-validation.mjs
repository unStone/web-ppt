import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { zipSync } from 'fflate';
import { safeUnzipSync } from '../packages/core/dist/zip.js';
import { prepareOoxmlSchemas } from './prepare-ooxml-schemas.mjs';
import { collectOoxmlArtifacts, filterSdkErrors, validateXsdParts, writeNormalizedPackage } from './lib/ooxml-validation.mjs';
import { countedAssert } from './lib/counted-assert.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out/ooxml-validation');
mkdirSync(out, { recursive: true });
const { assert, record } = countedAssert('ooxmlValidation');

/** 依赖工具缺失时给出可执行的安装指引，而不是 ENOENT 之类的运行时噪音。 */
for (const [tool, hint] of [
  ['xmllint', 'Ubuntu: sudo apt-get install -y libxml2-utils；macOS: brew install libxml2'],
  [process.env.DOTNET ?? 'dotnet', '安装 .NET SDK 8：https://dotnet.microsoft.com/download/dotnet/8.0'],
]) {
  if (spawnSync(tool, ['--version'], { encoding: 'utf8' }).error) {
    throw new Error(`OOXML 门禁依赖 ${tool}，当前环境不可用。${hint}`);
  }
}

const schemaDirectory = await prepareOoxmlSchemas();
const files = collectOoxmlArtifacts(root);
const xsdErrors = files.flatMap((file) => validateXsdParts(file, schemaDirectory));
writeFileSync(join(out, 'xsd-errors.json'), `${JSON.stringify(xsdErrors, null, 2)}\n`);
for (const error of xsdErrors) console.error(`[xsd] ${error.file} ${error.part} (${error.schema})\n${error.message}`);
assert.equal(xsdErrors.length, 0, '全部保存产物的 XML 部件必须通过 ECMA-376 Transitional XSD');

const dotnet = process.env.DOTNET ?? 'dotnet';
// SDK 通道校验同一份「等价归一化」副本：包结构与关系不变，测试标记与 MCE 读端语义
// 与 XSD 通道同一口径剥除，不让 SDK 把同一批内容再报一遍
const normalizedDirectory = join(out, 'normalized');
mkdirSync(normalizedDirectory, { recursive: true });
const normalizedFiles = files.map((file) => writeNormalizedPackage(file, join(normalizedDirectory, file.split('/').pop())));
const sdk = spawnSync(dotnet, ['run', '--project', 'tooling/ooxml-validate', '--no-restore', '--', ...normalizedFiles], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
writeFileSync(join(out, 'sdk-report.txt'), `${sdk.stdout}${sdk.stderr}`);
process.stdout.write(`${sdk.stdout}${sdk.stderr}`);
if (sdk.status !== 0 && sdk.status !== 1) {
  throw new Error(`OpenXmlValidator 运行失败（status=${sdk.status}）：${sdk.stderr}`);
}
// 退出码只区分「有无错误」；例外在 Node 侧按登记过滤，与 XSD 通道共用同一套例外原则
const { rejected, total, exempted } = filterSdkErrors(`${sdk.stdout}${sdk.stderr}`);
for (const block of rejected) console.error(`[sdk] ${block.trim()}`);
assert.equal(rejected.length, 0, `全部保存产物必须通过 OpenXmlValidator（Microsoft365）：${total} 条错误中 ${exempted} 条为登记例外`);

const sample = safeUnzipSync(readFileSync(join(root, 'fixtures/sample.pptx')));
// 解压结果是字节；负例只改目标部件的文本再编码回去
const rewrite = (parts, name, from, to) => {
  const text = new TextDecoder().decode(parts[name]);
  if (!text.includes(from)) throw new Error(`负例构造失败：${name} 不含 ${from}`);
  return { ...parts, [name]: new TextEncoder().encode(text.replace(from, to)) };
};
const structural = rewrite(sample, 'ppt/slides/slide1.xml', '<p:sld ', '<p:sldBroken ');
writeFileSync(join(out, 'negative-structural.pptx'), zipSync(structural));
assert(validateXsdParts(join(out, 'negative-structural.pptx'), schemaDirectory).length > 0, '结构负例必须被 xmllint 拦截');

const semantic = rewrite(sample, 'ppt/_rels/presentation.xml.rels', 'Target="slides/slide1.xml"', 'Target="slides/missing.xml"');
writeFileSync(join(out, 'negative-semantic.pptx'), zipSync(semantic));
const negative = spawnSync(
  dotnet,
  ['run', '--project', 'tooling/ooxml-validate', '--no-restore', '--', join(out, 'negative-semantic.pptx')],
  { cwd: root, encoding: 'utf8' },
);
assert.ok(
  filterSdkErrors(`${negative.stdout}${negative.stderr}`).rejected.length > 0,
  '关系目标缺失的语义负例必须被 OpenXmlValidator 拦截',
);

record();
console.log(
  `OOXML 合法性：${files.length} 份产物通过 XSD 与 OpenXmlValidator`
    + `（SDK 侧 ${total} 条错误中 ${exempted} 条为登记例外）；结构与语义负例均被拦截`,
);
