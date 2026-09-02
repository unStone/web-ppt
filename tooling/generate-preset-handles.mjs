/** 从固定版本的 Apache POI 规范几何定义生成纯数据句柄表；XML 不进入发布包。 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = process.argv[2];
const SOURCE_COMMIT = '6d94ace657249b487959dd654ca9d9b1c6014e4e';
const SOURCE_URL = `https://raw.githubusercontent.com/apache/poi/${SOURCE_COMMIT}`
  + '/poi/src/main/resources/org/apache/poi/sl/draw/geom/presetShapeDefinitions.xml';
const SOURCE_SHA256 = '4a762444d8d85876881c02a5b1dedf6f73006fcd8acb7b4e393435615b37c780';

if (!sourcePath) throw new Error(`请下载 ${SOURCE_URL} 并把本地路径作为第一个参数`);
const xml = readFileSync(sourcePath, 'utf8');
const hash = createHash('sha256').update(xml).digest('hex');
if (hash !== SOURCE_SHA256) throw new Error(`预设定义 SHA-256 不匹配：${hash}`);

const attrs = (source) => Object.fromEntries(
  [...source.matchAll(/([A-Za-z][\w:]*)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
);
const section = (body, name) =>
  body.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`))?.[1] ?? '';
const guides = (body) => [...body.matchAll(/<gd\s+([^>]*?)\s*\/>/g)].map((match) => {
  const value = attrs(match[1]);
  if (!value.name || !value.fmla) throw new Error('预设定义包含无名或无公式 guide');
  return [value.name, value.fmla];
});
const handles = (body) => [...body.matchAll(
  /<(ahXY|ahPolar)\s*([^>]*)>\s*<pos\s*([^>]*)\/>\s*<\/\1>/g,
)].map((match) => {
  const value = attrs(match[2]);
  const pos = attrs(match[3]);
  if (!pos.x || !pos.y) throw new Error('预设句柄缺少位置');
  return match[1] === 'ahXY'
    ? ['xy', value.gdRefX ?? null, value.minX ?? null, value.maxX ?? null,
      value.gdRefY ?? null, value.minY ?? null, value.maxY ?? null, pos.x, pos.y]
    : ['polar', value.gdRefR ?? null, value.minR ?? null, value.maxR ?? null,
      value.gdRefAng ?? null, value.minAng ?? null, value.maxAng ?? null, pos.x, pos.y];
});

const definitions = [];
for (const match of xml.matchAll(/^  <([A-Za-z0-9]+)>\s*$([\s\S]*?)^  <\/\1>\s*$/gm)) {
  const [, name, body] = match;
  definitions.push({
    name,
    defaults: guides(section(body, 'avLst')),
    guides: guides(section(body, 'gdLst')),
    handles: handles(section(body, 'ahLst')),
  });
}
if (definitions.length !== 187 || new Set(definitions.map(({ name }) => name)).size !== 187) {
  throw new Error(`预设定义数量不是 187：${definitions.length}`);
}

const names = definitions.map(({ name }) => name);
const withHandles = Object.fromEntries(definitions
  .filter((definition) => definition.handles.length)
  .map(({ name, defaults, guides: guideList, handles: handleList }) =>
    [name, [defaults, guideList, handleList]]));
const namesSource = names.map((name) => `  ${JSON.stringify(name)},`).join('\n');
const handlesSource = Object.entries(withHandles)
  .map(([name, definition]) => `  ${JSON.stringify(name)}: ${JSON.stringify(definition)},`)
  .join('\n');
const output = `/**
 * 由 tooling/generate-preset-handles.mjs 生成，请勿手改。
 * 来源：${SOURCE_URL}
 * SHA-256：${SOURCE_SHA256}
 */
import type { GuideDefinition } from '../guides';

export type RawPresetHandle = readonly [
  kind: 'xy' | 'polar', firstRef: string | null, firstMin: string | null,
  firstMax: string | null, secondRef: string | null, secondMin: string | null,
  secondMax: string | null, x: string, y: string,
];
export type RawPresetHandleDefinition = readonly [
  defaults: readonly GuideDefinition[], guides: readonly GuideDefinition[],
  handles: readonly RawPresetHandle[],
];

export const PRESET_DEFINITION_NAMES = [
${namesSource}
] as const;
export const PRESET_HANDLE_DEFINITIONS: Readonly<Record<string, RawPresetHandleDefinition>> =
  {
${handlesSource}
  };
`;
const target = join(root, 'packages/core/src/geometry/handles/generated.ts');
writeFileSync(target, output);
console.log(`${target} 已生成：187 个预设，${Object.keys(withHandles).length} 个含句柄`);
