import type { EditDoc } from '@web-ppt/edit-core';
import { sourcePartBytes } from '@web-ppt/edit-core';
import { findXmlAttribute, findXmlChild, findXmlDescendant, parseXmlTree, xmlElementChildren } from '../xml/index';
import type { XmlElement } from '../xml/index';
import type { DescriptionElement } from '../describe/types';
import { LayoutLintError } from './types';

export function promptReader(doc: EditDoc) {
  const cache = new Map<string, ReturnType<typeof parseXmlTree>>();
  return (element: DescriptionElement): string[] => {
    const ph = element.placeholder;
    if (!ph || ['dt', 'sldNum', 'ftr', 'hdr'].includes(ph.type)) return [];
    const target = ph.layout ?? ph.master;
    if (!target) return [];
    const origin = doc.elements[target.elementId]?.meta.origin;
    const bytes = origin && sourcePartBytes(doc, origin.part);
    if (!origin || !bytes) throw new LayoutLintError('placeholder-source-unavailable', `占位符 ${element.id} 缺少版式提示来源`, null, element.id);
    let tree = cache.get(origin.part); if (!tree) { tree = parseXmlTree(bytes); cache.set(origin.part, tree); }
    const text = (e: XmlElement): string => e.children.map(n => n.type === 'text' || n.type === 'cdata' ? n.value : n.type === 'element' ? text(n) : '').join('');
    const visit = (e: XmlElement): string[] | null => {
      if (['sp', 'pic', 'graphicFrame'].includes(e.localName)) {
        const nv = findXmlDescendant(e, { localName: 'cNvPr' });
        if (nv && Number(findXmlAttribute(nv, { localName: 'id' })?.value) === origin.spid) {
          const body = findXmlChild(e, { localName: 'txBody' });
          return body ? xmlElementChildren(body, { localName: 'p' }).map(p => xmlElementChildren(p).map(run => {
            if (run.localName === 'br') return '\n';
            return ['r', 'fld'].includes(run.localName) ? xmlElementChildren(run, { localName: 't' }).map(text).join('') : '';
          }).join('')).filter(s => s.trim()) : [];
        }
      }
      for (const c of xmlElementChildren(e)) { const found = visit(c); if (found) return found; }
      return null;
    };
    const found = visit(tree.root);
    if (!found) throw new LayoutLintError('placeholder-source-unavailable', `占位符 ${element.id} 的来源形状 ${origin.part}#${origin.spid} 不存在`, null, element.id);
    return found;
  };
}
