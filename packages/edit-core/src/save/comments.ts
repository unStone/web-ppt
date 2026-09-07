import { relativeTarget, resolveRelationshipTarget } from '../clipboard-source';
import type { EditDoc, SlideRecord } from '../types';
import { setXmlAttribute } from '../xml/mutate';
import { createXmlElement, insertXmlChildUnchecked, removeXmlChild } from '../xml/nodes';
import { findXmlAttribute, findXmlDescendant, xmlElementChildren } from '../xml/query';
import { parseXmlTree, serializeXmlTreeBytes } from '../xml/tree';
import type { XmlElement } from '../xml/types';
import { relationshipPartFor } from './clipboard-parts';

const attr = (node: XmlElement, name: string) => findXmlAttribute(node, { localName: name, namespaceUri: null })?.value;
const children = (root: XmlElement, name: string) => xmlElementChildren(root, { localName: name, namespaceUri: root.namespaceUri });
const relations = (bytes: Uint8Array) => children(parseXmlTree(bytes).root, 'Relationship');

/** 每页拥有自己的批注 part；不能像图片那样共享，否则副本与原页会成为同一组批注。 */
export function materializeDuplicateComments(
  doc: EditDoc, slides: readonly SlideRecord[], baselines: Record<string, Uint8Array>,
  created: Set<string>, changes: Record<string, Uint8Array | null>,
): void {
  const source = (part: string) => baselines[part] ?? doc.package?.parts[part];
  const jobs = slides.flatMap((slide) => {
    const owner = slide.creation?.duplicateSourcePart, target = slide.origin?.part;
    const bytes = owner && source(relationshipPartFor(owner));
    if (!bytes || !target) return [];
    return relations(bytes).filter((r) => attr(r, 'Type')?.endsWith('/comments') && attr(r, 'TargetMode') !== 'External')
      .map((relation) => ({ slide: target, id: attr(relation, 'Id')!, source: resolveRelationshipTarget(owner!, attr(relation, 'Target')!) }));
  });
  const previous = [...created].filter((part) => /^ppt\/comments\/(?:_rels\/)?web-ppt-(?!edit-)/.test(part));
  if (!jobs.length && !previous.length) return;
  const presentation = 'ppt/presentation.xml';
  const authorRel = relations(source(relationshipPartFor(presentation))!).find((r) => attr(r, 'Type')?.endsWith('/commentAuthors'));
  const authorPart = authorRel && resolveRelationshipTarget(presentation, attr(authorRel, 'Target')!);
  const authorBytes = authorPart && source(authorPart);
  if (authorPart && authorBytes) baselines[authorPart] ??= authorBytes.slice();
  // 老文件可能只有 authorId 而没有作者表；保留解析器的占位作者，不让复制阻断原本可保存的文稿。
  const authors = authorBytes ? parseXmlTree(authorBytes) : undefined, counters = new Map<string, number>();
  const used = new Map<string, Set<number>>();
  for (const node of authors ? children(authors.root, 'cmAuthor') : []) {
    counters.set(attr(node, 'id')!, Number(attr(node, 'lastIdx')) || 0);
    used.set(attr(node, 'id')!, new Set());
  }
  const typesPart = '[Content_Types].xml';
  const types = parseXmlTree((changes[typesPart] ?? source(typesPart)) as Uint8Array);
  // 作者的 lastIdx 可能落后于实际批注；按内容类型找原部件，不假设文件夹或文件名。
  for (const override of children(types.root, 'Override')) {
    const part = attr(override, 'PartName')?.slice(1);
    if (!part || created.has(part) || !attr(override, 'ContentType')?.endsWith('.comments+xml')) continue;
    const bytes = source(part);
    if (!bytes) throw new Error(`批注来源部件缺失：${part}`);
    for (const node of children(parseXmlTree(bytes).root, 'cm')) {
      const author = attr(node, 'authorId')!;
      const idx = Number(attr(node, 'idx'));
      if (!used.has(author)) used.set(author, new Set());
      if (!Number.isInteger(idx) || idx < 0 || idx > 0xffff_ffff) throw new Error('批注作者或索引无效');
      used.get(author)!.add(idx);
      counters.set(author, Math.max(counters.get(author) ?? 0, idx));
    }
  }
  for (const node of [...children(types.root, 'Override')]) {
    if (previous.includes(attr(node, 'PartName')?.slice(1) ?? '')) removeXmlChild(types.root, node);
  }
  const active = new Set<string>();
  for (const job of jobs) {
    const bytes = source(job.source);
    if (!bytes) throw new Error(`复制批注缺少来源部件：${job.source}`);
    const tree = parseXmlTree(bytes);
    let previousIndex = 0;
    const remapped = new Map<string, number>();
    for (const node of children(tree.root, 'cm').sort((a, b) => Number(attr(a, 'idx')) - Number(attr(b, 'idx')))) {
      const author = attr(node, 'authorId')!;
      if (!counters.has(author)) throw new Error(`复制批注缺少作者：${author}`);
      let idx = previousIndex + 1;
      while (used.get(author)!.has(idx)) idx++;
      if (idx > 0xffff_ffff) throw new Error('批注索引超出 OOXML 可表示范围');
      used.get(author)!.add(idx);
      counters.set(author, Math.max(counters.get(author)!, idx)); previousIndex = idx;
      remapped.set(`${author}:${attr(node, 'idx')}`, idx);
      setXmlAttribute(node, 'idx', String(idx));
    }
    for (const node of children(tree.root, 'cm')) {
      const parent = findXmlDescendant(node, { localName: 'parentCm', namespaceUri: 'http://schemas.microsoft.com/office/powerpoint/2012/main' });
      const idx = parent && remapped.get(`${attr(parent, 'authorId')}:${attr(parent, 'idx')}`);
      if (parent && idx !== undefined) setXmlAttribute(parent, 'idx', String(idx));
    }
    const stem = `ppt/comments/web-ppt-${job.slide.slice(job.slide.lastIndexOf('/') + 1).replace(/\.xml$/, '')}`;
    let part = `${stem}.xml`, suffix = 1;
    while (source(part) && !created.has(part)) part = `${stem}-${suffix++}.xml`;
    changes[part] = serializeXmlTreeBytes(tree); active.add(part); created.add(part);
    const rels = relationshipPartFor(job.slide), relTree = parseXmlTree(changes[rels] as Uint8Array);
    const relation = children(relTree.root, 'Relationship').find((r) => attr(r, 'Id') === job.id);
    if (!relation) throw new Error('复制批注目标关系缺失');
    setXmlAttribute(relation, 'Target', relativeTarget(job.slide, part));
    changes[rels] = serializeXmlTreeBytes(relTree);
    const childRels = source(relationshipPartFor(job.source));
    if (childRels) {
      const path = relationshipPartFor(part);
      const childTree = parseXmlTree(childRels);
      for (const relation of children(childTree.root, 'Relationship')) {
        const target = attr(relation, 'Target');
        if (!target || attr(relation, 'TargetMode') === 'External') continue;
        const fragment = target.includes('#') ? target.slice(target.indexOf('#')) : '';
        setXmlAttribute(relation, 'Target', relativeTarget(part, resolveRelationshipTarget(job.source, target)) + fragment);
      }
      changes[path] = serializeXmlTreeBytes(childTree); active.add(path); created.add(path);
    }
    insertXmlChildUnchecked(types.root, createXmlElement('Override', { attributes: [
      ['PartName', `/${part}`], ['ContentType', 'application/vnd.openxmlformats-officedocument.presentationml.comments+xml'],
    ] }));
  }
  for (const part of previous) if (!active.has(part)) changes[part] = null;
  for (const node of authors ? children(authors.root, 'cmAuthor') : []) setXmlAttribute(node, 'lastIdx', String(counters.get(attr(node, 'id')!) ?? 0));
  if (authors && authorPart) changes[authorPart] = serializeXmlTreeBytes(authors);
  changes[typesPart] = serializeXmlTreeBytes(types);
}
