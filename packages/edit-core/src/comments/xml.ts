import type { SlideComment } from '@web-ppt/core';
import { setXmlAttribute, removeXmlAttribute } from '../xml/mutate';
import { createXmlElement, createXmlText, insertXmlChildUnchecked, removeXmlChild } from '../xml/nodes';
import { findXmlAttribute, xmlElementChildren } from '../xml/query';
import type { XmlElement } from '../xml/types';

export const THREAD_URI = '{C676402C-5697-4E1C-873F-D02D1690AC5C}';
export const THREAD_NS = 'http://schemas.microsoft.com/office/powerpoint/2012/main';
export const attr = (node: XmlElement, name: string) => findXmlAttribute(node, { localName: name, namespaceUri: null })?.value;
export const children = (root: XmlElement, name: string) => xmlElementChildren(root, { localName: name });
export function add(parent: XmlElement, name: string, attributes: Record<string, string> = {}): XmlElement {
  const child = createXmlElement(name, { attributes: Object.entries(attributes) });
  insertXmlChildUnchecked(parent, child); return child;
}
export type CommentIdentity = { author: string; idx: number };

export function writeComment(node: XmlElement, comment: SlideComment, identity: CommentIdentity, parent?: CommentIdentity): void {
  setXmlAttribute(node, 'authorId', identity.author); setXmlAttribute(node, 'idx', String(identity.idx));
  if (comment.date) setXmlAttribute(node, 'dt', comment.date);
  else removeXmlAttribute(node, 'dt');
  for (const name of ['pos', 'text']) for (const child of children(node, name)) removeXmlChild(node, child);
  const prefix = node.prefix ? node.prefix + ':' : '';
  const emu = (n: number) => String(Math.round(n * 9525));
  const pos = createXmlElement(`${prefix}pos`, { attributes: [['x', emu(comment.x)], ['y', emu(comment.y)]] });
  const text = createXmlElement(`${prefix}text`); insertXmlChildUnchecked(text, createXmlText(comment.text));
  const first = node.children[0] ?? null;
  insertXmlChildUnchecked(node, pos, first); insertXmlChildUnchecked(node, text, first);
  let list = children(node, 'extLst')[0];
  if (list) for (const ext of children(list, 'ext')) if (attr(ext, 'uri') === THREAD_URI) removeXmlChild(list, ext);
  if (!parent) return;
  list ??= add(node, `${prefix}extLst`);
  const ext = add(list, `${prefix}ext`, { uri: THREAD_URI });
  const threading = add(ext, 'p15:threadingInfo', { 'xmlns:p15': THREAD_NS });
  add(threading, 'p15:parentCm', { authorId: parent.author, idx: String(parent.idx) });
}
