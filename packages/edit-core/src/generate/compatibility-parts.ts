import { relativeTarget, relationshipPartFor, resolveRelationshipTarget } from '../clipboard-source';
import { sessionAsset } from '../session-assets';
import type { EditDoc, ElementInsertionRelationship, ElementInsertionResource } from '../types';
import { resourceBytes } from '../save/clipboard-parts';
import { createXmlElement, insertXmlChildUnchecked } from '../xml/nodes';
import { findXmlAttribute, xmlElementChildren } from '../xml/query';
import { parseXmlTree, serializeXmlTreeBytes } from '../xml/tree';
import type { XmlElement } from '../xml/types';

const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const attr = (node: XmlElement, localName: string): string | undefined =>
  findXmlAttribute(node, { localName, namespaceUri: null })?.value;

/** 不透明对象的依赖保持原字节，只有页面到对象的关系需要换成生成页的新 rId。 */
export class CompatibilityParts {
  private readonly parts = new Map<string, Uint8Array>();
  private readonly media = new Map<string, { bytes: Uint8Array; mime: string }>();
  constructor(private readonly doc: EditDoc) {}

  source(part: string): Uint8Array | undefined {
    return this.media.get(part)?.bytes ?? sessionAsset(this.doc, `web-ppt-source:${part}`)?.bytes;
  }

  registerMedia(resources: readonly ElementInsertionResource[]): void {
    for (const resource of resources) {
      const bytes = resourceBytes(resource);
      const previous = this.source(resource.targetPart);
      if (previous && (previous.length !== bytes.length || previous.some((byte, i) => byte !== bytes[i]))) {
        throw new Error(`兼容对象的图片资源冲突：${resource.targetPart}`);
      }
      this.media.set(resource.targetPart, { bytes, mime: resource.mime });
    }
  }

  relationships(part: string): ElementInsertionRelationship[] {
    const bytes = this.source(relationshipPartFor(part));
    if (!bytes) return [];
    return xmlElementChildren(parseXmlTree(bytes).root, {
      localName: 'Relationship', namespaceUri: REL_NS,
    }).map((node) => {
      const id = attr(node, 'Id'), type = attr(node, 'Type'), target = attr(node, 'Target');
      const mode = attr(node, 'TargetMode');
      if (!id || !type || !target || mode && mode !== 'Internal' && mode !== 'External') {
        throw new Error(`兼容对象的关系无效：${part}`);
      }
      return { sourceId: id, targetId: id, type, target,
        ...(mode === 'External' ? { targetMode: 'External' as const } : {}) };
    });
  }

  private retain(part: string): void {
    if (this.parts.has(part)) return;
    const bytes = this.source(part);
    if (!bytes) throw new Error(`兼容对象缺少原包依赖：${part}`);
    this.parts.set(part, bytes);
    const rels = relationshipPartFor(part);
    const relsBytes = this.source(rels);
    if (relsBytes) this.parts.set(rels, relsBytes);
    for (const relation of this.relationships(part)) {
      if (!relation.targetMode) this.retain(resolveRelationshipTarget(part, relation.target));
    }
  }

  relocate(relation: ElementInsertionRelationship, from: string, to: string, id: string): ElementInsertionRelationship {
    if (relation.targetMode) return { ...relation, targetId: id };
    const target = resolveRelationshipTarget(from, relation.target);
    this.retain(target);
    const fragment = relation.target.includes('#') ? relation.target.slice(relation.target.indexOf('#')) : '';
    return { ...relation, targetId: id, target: relativeTarget(to, target) + fragment };
  }

  mergeInto(parts: Record<string, Uint8Array>): void {
    if (!this.parts.size) return;
    const source = this.source('[Content_Types].xml');
    if (!source) throw new Error('兼容对象缺少原包 Content-Types');
    const declarations = xmlElementChildren(parseXmlTree(source).root);
    const types = parseXmlTree(parts['[Content_Types].xml']);
    for (const [part, bytes] of this.parts) {
      const previous = parts[part];
      if (previous && (previous.length !== bytes.length || previous.some((byte, i) => byte !== bytes[i]))) {
        throw new Error(`兼容对象依赖与生成包 part 冲突：${part}`);
      }
      if (previous) continue;
      const direct = declarations.find((node) => node.localName === 'Override' && attr(node, 'PartName') === `/${part}`);
      const fallback = declarations.find((node) => node.localName === 'Default'
        && attr(node, 'Extension')?.toLowerCase() === part.split('.').pop()!.toLowerCase());
      const mime = this.media.get(part)?.mime ?? attr(direct ?? fallback ?? types.root, 'ContentType');
      if (!mime) throw new Error(`兼容对象依赖缺少 Content-Type：${part}`);
      insertXmlChildUnchecked(types.root, createXmlElement('Override', {
        attributes: [['PartName', `/${part}`], ['ContentType', mime]],
      }));
      parts[part] = bytes;
    }
    parts['[Content_Types].xml'] = serializeXmlTreeBytes(types);
  }
}
