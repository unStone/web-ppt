/**
 * 嵌入字体写入保存：EditDoc.fontResources → `ppt/fonts/*.fntdata` + presentation.xml
 * 的 `p:embeddedFontLst` + presRels 字体关系 + Content-Type 登记。
 *
 * 照 tableStyles 的先例（新部件 + presentation 级闭包）；部件字节在保存边界
 * 用 core 的 `wrapEotContainer` 封 EOT（不压缩，fsType 回写真实许可值），
 * 幂等：同资源重复保存产出相同部件名与字节。
 */
import type { FontEmbedResource } from '../types';
import type { EditDoc } from '../types';
import type { XmlElement } from '../xml/types';
import { wrapEotContainer } from '@web-ppt/core';
import { base64ToBytes } from '../clipboard-binary';
import { relativeTarget } from '../clipboard-source';
import { findXmlChild, xmlElementChildren } from '../xml/query';
import { insertXmlChildUnchecked } from '../xml/nodes';
import { namespacedElement } from '../save/xml-element';
import { setXmlAttribute } from '../xml/mutate';
import { parseXmlTree, serializeXmlTreeBytes } from '../xml/tree';
import { PRESENTATIONML_NS } from '../xml/qname';
import { patchContentTypes, patchRelationshipPart } from './clipboard-parts';

const FONT_RELATIONSHIP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/font';
const FONT_PART_DIR = 'ppt/fonts/';
const FONT_CONTENT_TYPE = 'application/x-fontdata';

export interface FontEmbedPart {
  readonly part: string;
  /** EOT 容器字节（含真实 fsType） */
  readonly bytes: Uint8Array;
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
}

export interface FontEmbedPlan {
  readonly parts: readonly FontEmbedPart[];
}

function styleName(bold: boolean, italic: boolean): string {
  return bold && italic ? 'Bold Italic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular';
}

function slotOf(bold: boolean, italic: boolean): 'regular' | 'bold' | 'italic' | 'boldItalic' {
  return bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular';
}

function eotBytes(resource: FontEmbedResource, bold: boolean, italic: boolean): Uint8Array {
  const bytes = base64ToBytes(resource.bytes);
  // 每个槽位对应同一 sfnt 的一个样式；PowerPoint 的四槽模型要求样式名与槽匹配
  return wrapEotContainer(bytes, {
    family: resource.family,
    style: styleName(bold, italic),
    bold,
    italic,
    fsType: resource.fsType,
  });
}

/**
 * 汇总要写入的字体部件。部件名按内容哈希寻址：重复保存与多端保存产出同一
 * 部件名与字节（PowerPoint 的 font1/font2 序号在补丁保存下无法幂等分配）。
 */
export function fontEmbedSavePlan(doc: EditDoc, existingParts: Readonly<Record<string, unknown>> = {}): FontEmbedPlan {
  const resources = Object.values(doc.fontResources ?? {});
  if (!resources.length) return { parts: [] };
  const used = new Set<string>();
  for (const part of Object.keys(existingParts)) {
    if (part.startsWith(FONT_PART_DIR)) used.add(part);
  }
  const parts: FontEmbedPart[] = [];
  for (const resource of resources) {
    const { bold, italic } = resource.styles.length ? resource.styles[resource.styles.length - 1] : { bold: false, italic: false };
    // 一个资源一个槽位：多样式以多次登记表达，避免在单条目里拼四槽。
    // 已存在的部件仍要写回——created part 未出现在 changes 里会被保存计划当作回收删除
    const part = `${FONT_PART_DIR}${resource.hash.replace(/[^a-z0-9-]/gi, '')}.fntdata`;
    used.add(part);
    parts.push({ part, bytes: eotBytes(resource, bold, italic), family: resource.family, bold, italic });
  }
  return { parts };
}

/** presentation.xml 的 `p:embeddedFontLst`：按字体族合并条目并写入槽位关系 */
export function patchEmbeddedFontList(
  source: Uint8Array,
  parts: readonly { family: string; bold: boolean; italic: boolean; relationshipId: string }[],
): Uint8Array {
  const tree = parseXmlTree(source);
  const root = tree.root;
  const list =
    findXmlChild(root, { localName: 'embeddedFontLst', namespaceUri: PRESENTATIONML_NS })
    ?? (() => {
      const created = namespacedElement(root, PRESENTATIONML_NS, 'embeddedFontLst');
      // schema 顺序：embeddedFontLst 紧跟 notesSz；取 notesSz 的下一个元素作插入锚
      const notesSize = findXmlChild(root, { localName: 'notesSz', namespaceUri: PRESENTATIONML_NS });
      const children = notesSize ? root.children : [];
      const index = notesSize ? children.indexOf(notesSize) : -1;
      const next = children[index + 1];
      insertXmlChildUnchecked(root, created, next?.type === 'element' ? next : null);
      return created;
    })();
  const byFamily = new Map<string, XmlElement>();
  for (const entry of xmlElementChildren(list, { localName: 'embeddedFont', namespaceUri: PRESENTATIONML_NS })) {
    const typeface = xmlElementChildren(entry, { localName: 'font', namespaceUri: PRESENTATIONML_NS })[0]?.attributes?.find(
      (attribute) => attribute.localName === 'typeface',
    )?.value;
    if (typeface) byFamily.set(typeface, entry);
  }
  for (const part of parts) {
    let entry = byFamily.get(part.family);
    if (!entry) {
      const created = namespacedElement(list, PRESENTATIONML_NS, 'embeddedFont');
      insertXmlChildUnchecked(list, created);
      const font = namespacedElement(created, PRESENTATIONML_NS, 'font');
      insertXmlChildUnchecked(created, font);
      setXmlAttribute(font, 'typeface', part.family);
      byFamily.set(part.family, created);
      entry = created;
    }
    // 幂等：已有槽位（内容寻址部件名不变）保持原关系 id，不重复插条目
    const slotName = slotOf(part.bold, part.italic);
    const existingSlot = xmlElementChildren(entry, { localName: slotName, namespaceUri: PRESENTATIONML_NS })[0];
    if (!existingSlot) {
      const slot = namespacedElement(entry, PRESENTATIONML_NS, slotName);
      insertXmlChildUnchecked(entry, slot);
      setXmlAttribute(slot, 'r:id', part.relationshipId);
    }
  }
  return serializeXmlTreeBytes(tree);
}

/** presRels 追加字体关系；已存在同目标关系时复用其 id，返回关系 id 供 embeddedFontLst 引用 */
export function patchFontPresentationRelationships(
  source: Uint8Array,
  parts: readonly { part: string; family: string; bold: boolean; italic: boolean }[],
): { bytes: Uint8Array; ids: string[] } {
  const ids: string[] = [];
  const tree = parseXmlTree(source);
  const relationships = xmlElementChildren(tree.root, { localName: 'Relationship' });
  const existing = new Map<string, string>();
  const used = new Set<string>();
  for (const node of relationships) {
    const attributes = node.attributes ?? [];
    const id = attributes.find((attribute) => attribute.localName === 'Id')?.value;
    const type = attributes.find((attribute) => attribute.localName === 'Type')?.value;
    const target = attributes.find((attribute) => attribute.localName === 'Target')?.value;
    if (id) used.add(id);
    if (id && type === FONT_RELATIONSHIP && target) existing.set(target, id);
  }
  let serial = 1;
  const next = (): string => {
    while (used.has(`rId${serial}`)) serial++;
    used.add(`rId${serial}`);
    return `rId${serial}`;
  };
  const additions: { sourceId: string; targetId: string; type: string; target: string }[] = [];
  for (const part of parts) {
    const target = relativeTarget('ppt/presentation.xml', part.part);
    const reused = existing.get(target);
    if (reused) {
      ids.push(reused);
      continue;
    }
    const id = next();
    ids.push(id);
    additions.push({ sourceId: id, targetId: id, type: FONT_RELATIONSHIP, target });
  }
  return { bytes: additions.length ? patchRelationshipPart(source, additions) : source, ids };
}

/** Content-Type 登记 fntdata Default（Ext 已存在时保持原样） */
export function patchFontContentType(source: Uint8Array): Uint8Array {
  return patchContentTypes(source, [
    {
      targetPart: `${FONT_PART_DIR}placeholder.fntdata`,
      hash: 'font-part',
      mime: FONT_CONTENT_TYPE,
      extension: 'fntdata',
      bytes: '',
      created: true,
    },
  ]);
}
