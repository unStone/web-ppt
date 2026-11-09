/**
 * 批注：经典 commentAuthors.xml / p:cm 与新版 authors.xml / p188:cm 收敛到同一份 SlideComment。
 */
import type { SlideComment } from '../types';
import { attr, emu, kid, kids, numAttr } from '../xml';
import type { Pkg } from './package-reader';
import type { Rels } from './slide-inheritance';

function extractText(root: Element | null): string {
  if (!root) return '';
  const out: string[] = [];
  const all = root.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === 't') out.push(all[i].textContent ?? '');
    else if (all[i].localName === 'p' && out.length) out.push('\n');
  }
  return out.join('').replace(/\n+/g, '\n').trim();
}

// ---------------- 批注 ----------------

export interface AuthorInfo {
  name: string;
  initials?: string;
}

/**
 * 作者表：经典 commentAuthors.xml（authorId 为数字）与新版 authors.xml（id 为 GUID）都收进同一张表。
 */
export function parseCommentAuthors(pkg: Pkg, presRels: Rels): Map<string, AuthorInfo> {
  const out = new Map<string, AuthorInfo>();
  for (const rel of Object.values(presRels)) {
    if (!/\/(commentAuthors|authors)$/.test(rel.type)) continue;
    const root = pkg.xml(rel.target);
    if (!root) continue;
    const all = root.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (el.localName !== 'cmAuthor' && el.localName !== 'author') continue;
      const id = attr(el, 'id');
      const name = attr(el, 'name');
      if (id === null || !name) continue;
      out.set(id, { name, initials: attr(el, 'initials') || undefined });
    }
  }
  return out;
}

/** 幻灯片批注：经典 p:cm（p:text）与新版 p188:cm（p188:txBody）走同一条 localName 路径 */
export function parseSlideComments(pkg: Pkg, slideRels: Rels, authors: Map<string, AuthorInfo>): SlideComment[] {
  const out: SlideComment[] = [];
  for (const rel of Object.values(slideRels)) {
    if (!rel.type.endsWith('/comments')) continue;
    const root = pkg.xml(rel.target);
    if (!root) continue;
    for (const cm of kids(root, 'cm')) {
      const authorId = attr(cm, 'authorId') ?? '';
      const author = authors.get(authorId);
      const pos = kid(cm, 'pos');
      const textEl = kid(cm, 'text');
      const text = textEl?.textContent ?? extractText(kid(cm, 'txBody')).trim();
      const idx = numAttr(cm, 'idx');
      const parent = Array.from(cm.getElementsByTagName('*')).find((node) => node.localName === 'parentCm'
        && node.namespaceURI === 'http://schemas.microsoft.com/office/powerpoint/2012/main');
      out.push({
        id: attr(cm, 'id') ?? `${authorId}:${idx ?? out.length}`,
        ...(parent ? { parentId: `${attr(parent, 'authorId') ?? ''}:${numAttr(parent, 'idx')}` } : {}),
        author: author?.name ?? (authorId ? `作者 ${authorId}` : '未知作者'),
        initials: author?.initials,
        date: attr(cm, 'dt') ?? attr(cm, 'created') ?? undefined,
        text,
        x: emu(numAttr(pos, 'x')),
        y: emu(numAttr(pos, 'y')),
        idx: idx !== null ? idx : undefined,
      });
    }
  }
  out.sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0));
  return out;
}
