import { writeComment } from '../comments/xml';
import type { CommentIdentity } from '../comments/xml';
import type { Slide } from '@web-ppt/core';
import { createXmlElement, insertXmlChildUnchecked } from '../xml/nodes';
import { findXmlAttribute, xmlElementChildren } from '../xml/query';
import { OFFICE_RELATIONSHIPS_NS, PRESENTATIONML_NS } from '../xml/qname';
import { parseXmlTree, serializeXmlTreeBytes } from '../xml/tree';
import type { XmlElement } from '../xml/types';
import { patchRelationshipPart, relationshipPartFor } from '../save/clipboard-parts';

function add(parent: XmlElement, name: string, attributes: Record<string, string> = {}): XmlElement {
  const child = createXmlElement(name, { attributes: Object.entries(attributes) });
  insertXmlChildUnchecked(parent, child);
  return child;
}

/** 批注不属于元素树；生成页面时必须另外写出，否则清空/复制元素会把只读内容静默丢掉。 */
export function materializeGeneratedComments(parts: Record<string, Uint8Array>, slides: readonly Slide[]): void {
  if (!slides.some((slide) => slide.comments?.length)) return;
  const tree = (name: string) => parseXmlTree(`<?xml version="1.0" encoding="UTF-8"?><p:${name} xmlns:p="${PRESENTATIONML_NS}"/>`);
  const types = parseXmlTree(parts['[Content_Types].xml']);
  const authors = tree('cmAuthorLst');
  const people = new Map<string, { id: string; last: number; name: string; initials?: string }>();
  const relation = (owner: string, target: string, type: string): void => {
    const path = relationshipPartFor(owner), source = parts[path];
    const used = new Set(source ? xmlElementChildren(parseXmlTree(source).root)
      .map((node) => findXmlAttribute(node, { localName: 'Id' })?.value) : []);
    let serial = 1;
    while (used.has(`rId${serial}`)) serial++;
    const id = `rId${serial}`;
    parts[path] = patchRelationshipPart(source, [{ sourceId: id, targetId: id,
      type: `${OFFICE_RELATIONSHIPS_NS}/${type}`, target }]);
  };
  const contentType = (part: string, type: string): void => {
    add(types.root, 'Override', { PartName: `/${part}`,
      ContentType: `application/vnd.openxmlformats-officedocument.presentationml.${type}+xml` });
  };
  let serial = 0;
  for (const [index, slide] of slides.entries()) {
    if (!slide.comments?.length) continue;
    const comments = tree('cmLst');
    const identities = new Map<string, CommentIdentity>();
    for (const [commentIndex, comment] of slide.comments.entries()) {
      const key = JSON.stringify([comment.author, comment.initials]);
      let person = people.get(key);
      if (!person) {
        person = { id: String(people.size), last: 0,
          name: comment.author, initials: comment.initials };
        people.set(key, person);
      }
      // 生成包统一紧凑编号，既保留页内阅读顺序，也不让来源的最大合法 idx 阻止复制。
      const idx = ++serial;
      if (idx > 0xffff_ffff) throw new Error('批注索引超出 OOXML 可表示范围');
      person.last = idx;
      identities.set(comment.id ?? `source:${commentIndex}`, { author: person.id, idx });
    }
    for (const [commentIndex, comment] of slide.comments.entries()) {
      const node = add(comments.root, 'p:cm');
      writeComment(node, comment, identities.get(comment.id ?? `source:${commentIndex}`)!,
        comment.parentId ? identities.get(comment.parentId) : undefined);
    }
    const part = `ppt/comments/comment${index + 1}.xml`;
    if (parts[part]) throw new Error(`生成批注 part 冲突：${part}`);
    parts[part] = serializeXmlTreeBytes(comments);
    contentType(part, 'comments');
    relation(`ppt/slides/slide${index + 1}.xml`, `../comments/comment${index + 1}.xml`, 'comments');
  }
  for (const person of people.values()) add(authors.root, 'p:cmAuthor', {
    id: person.id, name: person.name, initials: person.initials ?? '',
    lastIdx: String(person.last), clrIdx: person.id,
  });
  const part = 'ppt/commentAuthors.xml';
  if (parts[part]) throw new Error(`生成批注作者 part 冲突：${part}`);
  parts[part] = serializeXmlTreeBytes(authors);
  contentType(part, 'commentAuthors');
  relation('ppt/presentation.xml', 'commentAuthors.xml', 'commentAuthors');
  parts['[Content_Types].xml'] = serializeXmlTreeBytes(types);
}
