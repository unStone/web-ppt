import { relativeTarget, relationshipPartFor, resolveRelationshipTarget } from '../clipboard-source';
import type { EditDoc } from '../types';
import { setXmlAttribute } from '../xml/mutate';
import { cloneXmlNodeWithNamespaceClosure, createXmlElement, insertXmlChildUnchecked, removeXmlChild } from '../xml/nodes';
import { PRESENTATIONML_NS, OFFICE_RELATIONSHIPS_NS } from '../xml/qname';
import { parseXmlTree, serializeXmlTreeBytes } from '../xml/tree';
import { queryComments } from './state';
import { add, attr, children, writeComment } from './xml';
import type { CommentIdentity } from './xml';

const marker = 'ppt/comments/web-ppt-edit-';

const relationType = `${OFFICE_RELATIONSHIPS_NS}/comments`;

/** 新部件隔离编辑覆盖，旧部件保持基线；撤销后保存可以精确恢复来源关系。 */
export function materializeCommentEdits(doc: EditDoc, baselines: Record<string, Uint8Array>, created: Set<string>, changes: Record<string, Uint8Array | null>): void {
  const active = doc.slideOrder.filter((id) => doc.slides[id].ovr.extensions?.comments !== undefined);
  if (!active.length && ![...created].some((part) => part.startsWith(marker))) return;
  const source = (part: string) => baselines[part] ?? doc.package?.parts[part];
  const allocate = (stem: string) => {
    let part = `${stem}.xml`, index = 1;
    while (source(part) && !created.has(part)) part = `${stem}-${index++}.xml`;
    return part;
  };
  const targetPart = (owner: string) => allocate(`${marker}${owner.split('/').pop()!.replace(/\.xml$/, '')}`);
  const authorFallback = allocate(`${marker}authors`);
  const current = (part: string) => changes[part] ?? source(part);
  const remember = (part: string) => {
    const value = source(part); if (value && !created.has(part)) baselines[part] ??= value.slice();
  };
  const tree = (part: string) => parseXmlTree(current(part)!);
  const relTree = (owner: string) => {
    const path = relationshipPartFor(owner); remember(path);
    return { path, tree: parseXmlTree(current(path) ?? '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>') };
  };
  const types = tree('[Content_Types].xml'); remember('[Content_Types].xml');
  for (const node of [...children(types.root, 'Override')]) if (attr(node, 'PartName')?.slice(1).startsWith(marker) && created.has(attr(node, 'PartName')!.slice(1))) removeXmlChild(types.root, node);
  const presentation = relTree('ppt/presentation.xml');
  const authorRel = children(presentation.tree.root, 'Relationship').find((r) => attr(r, 'Type')?.endsWith('/commentAuthors'));
  const authorPart = authorRel ? resolveRelationshipTarget('ppt/presentation.xml', attr(authorRel, 'Target')!) : authorFallback;
  remember(authorPart);
  const authors = parseXmlTree((created.has(authorPart) ? changes[authorPart] : current(authorPart)) ?? `<p:cmAuthorLst xmlns:p="${PRESENTATIONML_NS}"/>`);
  const people = new Map(children(authors.root, 'cmAuthor').map((person) =>
    [JSON.stringify([attr(person, 'name'), attr(person, 'initials') ?? '']), person]));
  const usedAuthors = new Set([...people.values()].map((p) => attr(p, 'id')));
  let nextAuthor = 0, nextIndex = 0;
  const usedIndices = new Set<number>();
  // lastIdx 不是可靠的最大值，旧文件与复制页都需要扫描实际引用。
  for (const node of children(types.root, 'Override')) {
    if (!attr(node, 'ContentType')?.endsWith('.comments+xml')) continue;
    const bytes = current(attr(node, 'PartName')!.slice(1)); if (!bytes) continue;
    for (const comment of children(parseXmlTree(bytes).root, 'cm')) usedIndices.add(Number(attr(comment, 'idx')) || 0);
  }
  const addType = (part: string, kind: string) => add(types.root, 'Override', { PartName: `/${part}`,
    ContentType: `application/vnd.openxmlformats-officedocument.presentationml.${kind}+xml` });
  const addRel = (root: ReturnType<typeof relTree>['tree']['root'], target: string, type: string) => {
    const used = new Set(children(root, 'Relationship').map((r) => attr(r, 'Id')));
    let serial = 1; while (used.has(`rId${serial}`)) serial++;
    add(root, 'Relationship', { Id: `rId${serial}`, Type: type, Target: target });
  };
  for (const id of doc.slideOrder) {
    const slide = doc.slides[id], owner = slide.origin?.part;
    if (!owner) continue;
    const path = relationshipPartFor(owner), prior = source(path);
    if (!active.includes(id) && !created.has(targetPart(owner))) continue;
    const relations = relTree(owner);
    const originalOwner = slide.creation?.duplicateSourcePart ?? owner;
    const originalRelations = source(relationshipPartFor(originalOwner));
    const original = originalRelations && children(parseXmlTree(originalRelations).root, 'Relationship')
      .find((r) => attr(r, 'Type')?.endsWith('/comments'));
    for (const r of [...children(relations.tree.root, 'Relationship')]) if (attr(r, 'Type')?.endsWith('/comments')) removeXmlChild(relations.tree.root, r);
    if (!active.includes(id)) {
      // 已由复制页物化的关系优先保留，普通页面恢复最初关系。
      const bytes = slide.creation ? current(path) : prior;
      if (bytes) for (const relation of children(parseXmlTree(bytes).root, 'Relationship')) if (attr(relation, 'Type')?.endsWith('/comments')) insertXmlChildUnchecked(relations.tree.root, cloneXmlNodeWithNamespaceClosure(relation, relations.tree.root));
      changes[path] = serializeXmlTreeBytes(relations.tree); continue;
    }
    const originalBytes = original && source(resolveRelationshipTarget(originalOwner, attr(original, 'Target')!));
    const originals = new Map(originalBytes ? children(parseXmlTree(originalBytes).root, 'cm')
      .map((c) => [`${attr(c, 'authorId')}:${attr(c, 'idx')}`, c]) : []);
    const list = parseXmlTree(`<p:cmLst xmlns:p="${PRESENTATIONML_NS}"/>`);
    const comments = queryComments(doc, id), identities = new Map<string, CommentIdentity>();
    for (const comment of comments) {
      const key = JSON.stringify([comment.author, comment.initials ?? '']);
      let person = people.get(key);
      if (!person) {
        while (usedAuthors.has(String(nextAuthor))) nextAuthor++;
        person = add(authors.root, 'p:cmAuthor', { id: String(nextAuthor), name: comment.author,
          initials: comment.initials ?? '', lastIdx: '0', clrIdx: String(nextAuthor) });
        usedAuthors.add(String(nextAuthor++)); people.set(key, person);
      }
      do { nextIndex++; } while (usedIndices.has(nextIndex));
      if (nextIndex > 0xffff_ffff) throw new Error('批注索引超出 OOXML 范围');
      usedIndices.add(nextIndex);
      setXmlAttribute(person, 'lastIdx', String(Math.max(Number(attr(person, 'lastIdx')) || 0, nextIndex)));
      identities.set(comment.id!, { author: attr(person, 'id')!, idx: nextIndex });
    }
    for (const comment of comments) {
      const template = originals.get(comment.id!);
      const node = template ? cloneXmlNodeWithNamespaceClosure(template, list.root) : createXmlElement('p:cm');
      writeComment(node, comment, identities.get(comment.id!)!, comment.parentId ? identities.get(comment.parentId) : undefined);
      insertXmlChildUnchecked(list.root, node);
    }
    {
      const part = targetPart(owner);
      created.add(part); changes[part] = serializeXmlTreeBytes(list); addType(part, 'comments');
      addRel(relations.tree.root, relativeTarget(owner, part), relationType);
    }
    changes[path] = serializeXmlTreeBytes(relations.tree);
  }
  if (active.length) {
    changes[authorPart] = serializeXmlTreeBytes(authors);
    if (authorPart === authorFallback) {
      created.add(authorPart); addType(authorPart, 'commentAuthors');
      if (!authorRel) addRel(presentation.tree.root, relativeTarget('ppt/presentation.xml', authorPart), `${OFFICE_RELATIONSHIPS_NS}/commentAuthors`);
    }
  } else if (baselines[authorPart] && !changes[authorPart]) changes[authorPart] = baselines[authorPart];
  changes[presentation.path] = serializeXmlTreeBytes(presentation.tree);
  changes['[Content_Types].xml'] = serializeXmlTreeBytes(types);
}
