import { unzipSync } from 'fflate';
import type { OpcPackage } from '@web-ppt/core';
import { findXmlAttribute, parseXmlTree, serializeXmlTreeBytes, setXmlAttribute, xmlElementChildren } from '@web-ppt/edit-core/xml';
import { disposeOpcPackage, patchOpcPackage } from '@web-ppt/edit-core/opc';
import { TemplateFillError } from './errors';

const TYPES = '[Content_Types].xml';
const TEMPLATE = 'application/vnd.openxmlformats-officedocument.presentationml.template.main+xml';
const PRESENTATION = 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';
const TYPE_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';

/** 核心解析器先验证输入规模与格式；这里只转换普通模板的精确类型，不推断宏类型。 */
export function prepareTemplatePackage(bytes: Uint8Array): Uint8Array {
  const selected = unzipSync(bytes, { filter: entry => entry.name === TYPES });
  const source = selected[TYPES];
  if (!source) throw new TemplateFillError('invalid-template', '模板包缺少 Content Types');
  const tree = parseXmlTree(source);
  const main = xmlElementChildren(tree.root, { localName: 'Override', namespaceUri: TYPE_NS })
    .find(node => findXmlAttribute(node, { localName: 'PartName', namespaceUri: null })?.value === '/ppt/presentation.xml');
  const type = main && findXmlAttribute(main, { localName: 'ContentType', namespaceUri: null })?.value;
  if (type === PRESENTATION) return bytes;
  if (!main || type !== TEMPLATE) {
    throw new TemplateFillError('unsupported-template', `模板主部件类型 ${type ?? '(缺失)'} 不属于普通 PPTX/POTX`);
  }
  setXmlAttribute(main, 'ContentType', PRESENTATION);
  const parts = unzipSync(bytes);
  const pkg: OpcPackage = { format: 'pptx', bytes, parts, disposed: false };
  const result = patchOpcPackage(pkg, { [TYPES]: serializeXmlTreeBytes(tree) });
  disposeOpcPackage(result.package);
  return result.bytes;
}
