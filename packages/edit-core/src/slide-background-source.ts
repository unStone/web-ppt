import { clipboardClosure } from './clipboard-source';
import { relationshipPartFor, resolveRelationshipTarget } from './clipboard-source';
import type { ClipboardClosure } from './clipboard-source';
import type { OpcPackage } from '@web-ppt/core';
import type { EditDoc, SlideRecord } from './types';
import { findXmlAttribute, findXmlChild, xmlElementChildren } from './xml/query';
import { DRAWINGML_NS, PRESENTATIONML_NS } from './xml/qname';
import { parseXmlTree } from './xml/tree';
import type { XmlElement } from './xml/types';

const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export interface SourceImageBackground {
  readonly package: OpcPackage;
  readonly part: string;
  readonly background: XmlElement;
  readonly imageRelationshipId: string;
  readonly closure: ClipboardClosure;
}

function sourcePackage(doc: EditDoc): OpcPackage | null {
  if (!doc.package) return null;
  if (!Object.keys(doc.saveState.baselines).length) return doc.package;
  return {
    ...doc.package,
    // baselines 是模型 src 的词法真值；已保存的 package 可能仍承载后来又被撤销的覆盖。
    parts: { ...doc.package.parts, ...doc.saveState.baselines },
  };
}

function relatedPart(pkg: OpcPackage, part: string, relationSuffix: string): string | null {
  const bytes = pkg.parts[relationshipPartFor(part)];
  if (!bytes) return null;
  const relationship = xmlElementChildren(parseXmlTree(bytes).root, { localName: 'Relationship' })
    .find((node) => findXmlAttribute(node, { localName: 'Type', namespaceUri: null })
      ?.value.endsWith(relationSuffix));
  const target = relationship
    && findXmlAttribute(relationship, { localName: 'Target', namespaceUri: null })?.value;
  return target ? resolveRelationshipTarget(part, target) : null;
}

function backgroundFromPart(
  pkg: OpcPackage,
  part: string,
): { readonly found: boolean; readonly background: XmlElement | null; readonly rid: string | null } {
  const bytes = pkg.parts[part];
  if (!bytes) return { found: false, background: null, rid: null };
  const common = findXmlChild(parseXmlTree(bytes).root, {
    localName: 'cSld', namespaceUri: PRESENTATIONML_NS,
  });
  const background = common && findXmlChild(common, {
    localName: 'bg', namespaceUri: PRESENTATIONML_NS,
  });
  if (!background) return { found: false, background: null, rid: null };
  const properties = findXmlChild(background, {
    localName: 'bgPr', namespaceUri: PRESENTATIONML_NS,
  });
  const fill = properties && findXmlChild(properties, {
    localName: 'blipFill', namespaceUri: DRAWINGML_NS,
  });
  const blip = fill && findXmlChild(fill, { localName: 'blip', namespaceUri: DRAWINGML_NS });
  const rid = blip && (findXmlAttribute(blip, { localName: 'embed', namespaceUri: OFFICE_REL_NS })
    ?? findXmlAttribute(blip, { localName: 'link', namespaceUri: OFFICE_REL_NS }))?.value;
  return { found: true, background: fill && rid ? background : null, rid: rid ?? null };
}

/** 按 slide → layout → master 的继承停止规则定位真正提供当前图片背景的 OPC 宿主。 */
export function sourceImageBackground(doc: EditDoc, record: SlideRecord): SourceImageBackground | null {
  const pkg = sourcePackage(doc);
  if (!pkg || record.src.background?.type !== 'image') return null;
  // 新建页保存后的目标 part 是用户覆盖，不是 src；副本则必须回到最初不可变页面基线。
  const slidePart = record.creation?.duplicateSourcePart
    ?? (record.creation ? null : record.origin?.part ?? null);
  const master = record.layoutId ? relatedPart(pkg, record.layoutId, '/slideMaster') : null;
  for (const part of [slidePart, record.layoutId ?? null, master]) {
    if (!part) continue;
    const candidate = backgroundFromPart(pkg, part);
    // 第一份显式背景即终止继承；非图片背景不能越过后继续猜母版。
    if (candidate.found) {
      if (!candidate.background || !candidate.rid) return null;
      return {
        package: pkg, part, background: candidate.background, imageRelationshipId: candidate.rid,
        closure: clipboardClosure(pkg, part, candidate.background),
      };
    }
  }
  return null;
}
