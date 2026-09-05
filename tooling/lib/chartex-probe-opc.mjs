import { posix } from 'node:path';
import { parseXmlTree, xmlElementChildren } from '../../packages/edit-core/dist/xml.js';

const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** 包内关系与外链统一报告，避免图表 envelope 和工作簿调查各自解释目标。 */
export function relationships(parts, part) {
  const path = posix.join(posix.dirname(part), '_rels', `${posix.basename(part)}.rels`);
  if (!parts[path]) return [];
  return xmlElementChildren(parseXmlTree(parts[path]).root, { localName: 'Relationship', namespaceUri: REL }).map((node) => {
    const attr = (name) => node.attributes.find((a) => a.localName === name && a.namespaceUri === null)?.value ?? null;
    const target = attr('Target');
    const external = attr('TargetMode') === 'External';
    // 外链只登记，不允许探针把本地文件引用升级为网络访问。
    const resolved = target && !external
      ? posix.normalize(target.startsWith('/') ? target.slice(1) : posix.join(posix.dirname(part), target)) : null;
    return { id: attr('Id'), type: attr('Type'), target, external, resolved,
      exists: resolved !== null && Object.hasOwn(parts, resolved) };
  });
}
