import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { zipSync } from 'fflate';
import { safeUnzipSync } from '../../packages/core/dist/zip.js';
import {
  cloneXmlNode, insertXmlChildUnchecked, parseXmlTree, removeXmlAttribute, removeXmlChild,
  serializeXmlTree, xmlElementChildren,
} from '../../packages/edit-core/dist/xml.js';

export function collectOoxmlArtifacts(root) {
  const files = [];
  for (const directory of ['out/edit-save', 'out/v07-integration', 'out/v08-integration']) {
    const manifest = join(root, directory, 'office-artifacts.json');
    if (!existsSync(manifest)) throw new Error(`缺少保存产物清单 ${manifest}，请先运行对应功能测试`);
    for (const artifact of JSON.parse(readFileSync(manifest, 'utf8')).artifacts) {
      const file = join(root, directory, artifact.file);
      if (!existsSync(file)) throw new Error(`保存产物不存在：${file}`);
      files.push(file);
    }
  }
  for (const directory of ['out/agent-tools', 'out/agent-mcp', 'out/template-fill']) {
    for (const name of readdirSync(join(root, directory)).filter(name => name.endsWith('.pptx')).sort()) {
      files.push(join(root, directory, name));
    }
  }
  return [...new Set(files)];
}

const NAMESPACE_SCHEMA = new Map(Object.entries({
  'http://schemas.openxmlformats.org/package/2006/content-types': 'opc-contentTypes.xsd',
  'http://schemas.openxmlformats.org/package/2006/relationships': 'opc-relationships.xsd',
  'http://schemas.openxmlformats.org/package/2006/metadata/core-properties': 'opc-coreProperties.xsd',
  'http://schemas.openxmlformats.org/presentationml/2006/main': 'pml.xsd',
  'http://schemas.openxmlformats.org/drawingml/2006/main': 'dml-main.xsd',
  'http://schemas.openxmlformats.org/drawingml/2006/chart': 'dml-chart.xsd',
  'http://schemas.openxmlformats.org/drawingml/2006/chartDrawing': 'dml-chartDrawing.xsd',
  'http://schemas.openxmlformats.org/drawingml/2006/diagram': 'dml-diagram.xsd',
  'http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas': 'dml-lockedCanvas.xsd',
  'http://schemas.openxmlformats.org/drawingml/2006/picture': 'dml-picture.xsd',
  'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing': 'dml-spreadsheetDrawing.xsd',
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing': 'dml-wordprocessingDrawing.xsd',
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main': 'sml.xsd',
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main': 'wml.xsd',
  'http://schemas.openxmlformats.org/officeDocument/2006/math': 'shared-math.xsd',
  'http://schemas.openxmlformats.org/officeDocument/2006/bibliography': 'shared-bibliography.xsd',
  'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes': 'shared-documentPropertiesVariantTypes.xsd',
  'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties': 'shared-documentPropertiesExtended.xsd',
  'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties': 'shared-documentPropertiesCustom.xsd',
  'http://schemas.openxmlformats.org/officeDocument/2006/customXml': 'shared-customXmlDataProperties.xsd',
  'http://schemas.openxmlformats.org/schemaLibrary/2006/main': 'shared-customXmlSchemaProperties.xsd',
  'urn:schemas-microsoft-com:vml': 'vml-main.xsd',
  'urn:schemas-microsoft-com:office:office': 'vml-officeDrawing.xsd',
  'urn:schemas-microsoft-com:office:powerpoint': 'vml-presentationDrawing.xsd',
  'urn:schemas-microsoft-com:office:excel': 'vml-spreadsheetDrawing.xsd',
  'urn:schemas-microsoft-com:office:word': 'vml-wordprocessingDrawing.xsd',
}));

/**
 * 无 ECMA-376 XSD 映射、但属于已知合法的根命名空间，逐条登记原因（票据 005 的例外清单）：
 * - chartex：Microsoft 2014 扩展（MS-ODRAWXML），ECMA-376 不含其 XSD；结构由 OpenXmlValidator 侧把关。
 * - InkML：墨迹部件是 W3C InkML 文档，不属于 OOXML 标记词汇。
 * 测试标记部件（urn:web-ppt:*）只存在于固件与产物，验证它们没有意义。
 */
const UNMAPPED_ROOT_EXCEPTIONS = [
  ['http://schemas.microsoft.com/office/drawing/2014/chartex', 'Microsoft chartex 扩展，无 ECMA-376 XSD'],
  ['http://www.w3.org/2003/InkML', 'InkML 墨迹部件，不属于 OOXML 词汇'],
];

/**
 * xmllint 报错中已知与生态实践冲突、逐条放行的规则（票据 005 的例外清单）。
 * 判定必须锚定具体规则形态，不允许按部件或文件整类忽略。
 */
const XSD_ERROR_EXCEPTIONS = [
  {
    test: /\}buSzPct', attribute 'val': \[facet 'pattern'\]/,
    reason: '5th edition XSD 把 ST_TextBulletSizePercent 定为带百分号的字符串；'
      + 'PowerPoint 与 Open XML SDK 实际写千分比整数（如 val="135000"）',
  },
  {
    test: /\{http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/math\}oMath(?:Para)?': This element is not expected/,
    reason: '两个校验器的 schema 都未在 DrawingML 段落声明 Office Math；'
      + 'LibreOffice 与本引擎直接书写裸 m:oMath，PowerPoint 实际宽容接受',
  },
];

/** OpenXmlValidator 报错块（`[Id] 描述 + part + xpath` 三行）中同样需要放行的规则。 */
const SDK_ERROR_EXCEPTIONS = [
  {
    test: (block) => block.includes('[Sch_InvalidElementContentExpectingComplex]') && /math:oMath/.test(block),
    reason: 'DrawingML 段落中的裸 m:oMath：SDK schema 未声明，PowerPoint 实际接受（LibreOffice 同样如此书写）；'
      + '改写为 MCE a14:m 包装属于后续数学创作票据，不在本门禁范围',
  },
];

const MARKER_NAMESPACE_PREFIX = 'urn:web-ppt:';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const DRAWINGML_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';

const isMarkerNamespace = (uri) => typeof uri === 'string' && uri.startsWith(MARKER_NAMESPACE_PREFIX);

/**
 * 校验前的等价归一化，只剥离「不属于 OOXML 词汇本身」的内容：
 * - MCE：AlternateContent 取 Fallback（无则 Choice）分支展开；根上 mc:Ignorable 列出的
 *   前缀按 MCE 读端语义丢弃（不认识的内容本就允许忽略），再删除 mc:Ignorable 自身；
 * - 测试标记：urn:web-ppt:* 的属性与元素是固件用来证明「未知内容被保留」的探针，
 *   其存活性由功能断言负责，XSD 只需要校验其余真实内容。
 *   例外：`<ext uri="urn:web-ppt:*">` 是产品写入的真实扩展容器（如图表数据身份清单），
 *   容器内的内容不能当测试标记剥掉；
 * - a:t 上的 xml:space="preserve"：XSD 未声明 xml 通配，但 PowerPoint / LibreOffice /
 *   python-pptx 均书写该属性，属于生态标准形态。
 * 注意：本仓库 XML 实现的属性变更必须走 removeXmlAttribute，
 * 直接改写 element.attributes 不会反映到序列化状态里。
 */
function normalizeElement(element, ignorablePrefixes, insideProductExtension = false) {
  if (element.type !== 'element') return;
  const productExtension = insideProductExtension
    || (element.localName === 'ext' && (element.attributes.find((item) => item.localName === 'uri')?.value ?? '').startsWith(MARKER_NAMESPACE_PREFIX));
  for (const attribute of [...element.attributes]) {
    if (productExtension) continue;
    if (isMarkerNamespace(attribute.namespaceUri)) removeXmlAttribute(element, attribute.name);
    else if (attribute.namespaceUri === MC && attribute.localName === 'Ignorable') removeXmlAttribute(element, 'mc:Ignorable');
    else if (ignorablePrefixes.has(attribute.prefix)) removeXmlAttribute(element, attribute.name);
    else if (element.namespaceUri === DRAWINGML_NS && element.localName === 't'
      && attribute.namespaceUri === 'http://www.w3.org/XML/1998/namespace') removeXmlAttribute(element, 'xml:space');
  }
  for (const child of [...element.children]) {
    if (child.type !== 'element') continue;
    if (!productExtension && (isMarkerNamespace(child.namespaceUri) || ignorablePrefixes.has(child.prefix))) {
      removeXmlChild(element, child);
      continue;
    }
    if (child.namespaceUri === MC && child.localName === 'AlternateContent') {
      const replacements = alternateReplacement(child);
      const next = element.children[element.children.indexOf(child) + 1] ?? null;
      removeXmlChild(element, child);
      for (const replacement of replacements) insertXmlChildUnchecked(element, replacement, next);
      for (const replacement of replacements) normalizeElement(replacement, ignorablePrefixes, productExtension);
    } else {
      normalizeElement(child, ignorablePrefixes, productExtension);
    }
    // 测试标记剥空后的 ext 只剩空壳；ext 的内容模型要求至少一个子元素，整只移除
    if (!productExtension && child.localName === 'ext' && !xmlElementChildren(child).length) {
      removeXmlChild(element, child);
    }
  }
}

/** 根上的 mc:Ignorable 只按前缀生效；这里返回前缀集合，供 MCE 读端语义丢弃。 */
function ignorablePrefixesOf(root) {
  const attribute = root.attributes.find((item) => item.namespaceUri === MC && item.localName === 'Ignorable');
  return new Set(attribute ? attribute.value.trim().split(/\s+/).filter(Boolean) : []);
}

function alternateReplacement(element) {
  const branches = element.children.filter(node => node.type === 'element');
  const fallback = branches.find(node => node.namespaceUri === MC && node.localName === 'Fallback');
  const choice = branches.find(node => node.namespaceUri === MC && node.localName === 'Choice');
  const selected = fallback ?? choice;
  return selected ? selected.children.map(node => cloneXmlNode(node)) : [];
}

export function normalizedXml(bytes) {
  const tree = parseXmlTree(bytes);
  if (isMarkerNamespace(tree.root.namespaceUri)) return null;
  const ignorablePrefixes = ignorablePrefixesOf(tree.root);
  if (tree.root.namespaceUri === MC && tree.root.localName === 'AlternateContent') {
    const replacements = alternateReplacement(tree.root);
    if (replacements.length !== 1) throw new Error('MCE 根节点必须有唯一兼容分支');
    tree.root = replacements[0];
    normalizeElement(tree.root, ignorablePrefixes);
  } else {
    normalizeElement(tree.root, ignorablePrefixes);
  }
  return serializeXmlTree(tree);
}

export function schemaForPart(root) {
  return NAMESPACE_SCHEMA.get(root.namespaceUri) ?? null;
}

export function unmappedRootReason(root) {
  if (isMarkerNamespace(root.namespaceUri)) return '测试标记部件';
  return UNMAPPED_ROOT_EXCEPTIONS.find(([uri]) => uri === root.namespaceUri)?.[1] ?? null;
}

/**
 * 把 OpenXmlValidator 输出拆成错误块：每条以 `[ErrorId]` 开头（Sch_* 结构、Sem_* 语义、
 * Pkg_* 包等前缀都有），包无法加载是 `[load-error]`。按通用 Id 形态切分，
 * 任何类别都不能因为前缀不在白名单里而被漏计。
 */
const SDK_ERROR_ID = /\[(?:[A-Za-z]+_\w+|load-error)\]/;
export function sdkErrorBlocks(output) {
  return output.split(/(?=\n?\s*\[(?:[A-Za-z]+_\w+|load-error)\])/g)
    .filter((block) => SDK_ERROR_ID.test(block));
}

/** 例外与 XSD 通道共用同一登记原则：逐条匹配规则形态，不按部件或文件整类忽略。 */
export function filterSdkErrors(output) {
  const blocks = sdkErrorBlocks(output);
  const rejected = blocks.filter((block) =>
    !SDK_ERROR_EXCEPTIONS.some(({ test }) => test(block)));
  return { rejected, total: blocks.length, exempted: blocks.length - rejected.length };
}

export function validateXsdParts(file, schemaDirectory) {
  const parts = safeUnzipSync(readFileSync(file));
  const errors = [];
  for (const [name, bytes] of Object.entries(parts)) {
    if (!name.endsWith('.xml') && !name.endsWith('.rels')) continue;
    let root;
    try { root = parseXmlTree(bytes).root; }
    catch (error) {
      errors.push({ file, part: name, schema: '(well-formed)', message: error.message });
      continue;
    }
    const schema = schemaForPart(root);
    if (!schema) {
      const reason = unmappedRootReason(root);
      if (!reason) {
        errors.push({ file, part: name, schema: '(unmapped)',
          message: `没有 ECMA-376 Transitional XSD 映射：${root.namespaceUri}/${root.localName}` });
      }
      continue;
    }
    const normalized = normalizedXml(bytes);
    const result = spawnSync('xmllint', ['--noout', '--schema', join(schemaDirectory, schema), '-'],
      { input: normalized, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0) {
      for (const line of `${result.stderr}\n${result.stdout}`.split('\n')) {
        if (!line.includes('Schemas validity error')) continue;
        if (XSD_ERROR_EXCEPTIONS.some(({ test }) => test.test(line))) continue;
        errors.push({ file, part: name, schema, message: line });
      }
    }
  }
  return errors;
}

/**
 * 把产物按 normalizedXml 的同一口径重打包，供 OpenXmlValidator 校验——
 * 双通道必须看同一份「等价归一化」内容：测试标记与 MCE 读端语义不该由 SDK 再报一遍。
 * 包结构、部件集合与关系保持不变，语义校验（关系目标、跨部件不变量）不受影响。
 */
export function writeNormalizedPackage(file, destination) {
  const parts = safeUnzipSync(readFileSync(file));
  const normalized = {};
  for (const [name, bytes] of Object.entries(parts)) {
    if (!(name.endsWith('.xml') || name.endsWith('.rels'))) { normalized[name] = bytes; continue; }
    let root;
    try { root = parseXmlTree(bytes).root; } catch { normalized[name] = bytes; continue; }
    // 测试标记根与无 XSD 映射的部件原样保留，交给 SDK 的跳过或豁免语义
    const out = isMarkerNamespace(root.namespaceUri) ? bytes : normalizedXml(bytes);
    normalized[name] = typeof out === 'string' ? new TextEncoder().encode(out) : out;
  }
  writeFileSync(destination, zipSync(normalized));
  return destination;
}
