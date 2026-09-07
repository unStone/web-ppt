import { sourcePartBytes } from '@web-ppt/edit-core';
import type { EditDoc } from '@web-ppt/edit-core';
import { renderInkXml } from '@web-ppt/core/ink-edit';
import { parseXmlTree, serializeXmlTreeBytes, xmlElementChildren, createXmlElement,
  insertXmlChildUnchecked as append, removeXmlChild, setXmlAttribute, removeXmlAttribute } from '@web-ppt/edit-core/xml';
import type { XmlElement } from '@web-ppt/edit-core/xml';
import { sha256 } from '../clipboard-binary';
import { attr, child, children, relPart, resolvePart, R } from '../ole/container';
import { inkSource } from './source';
import { normalizeInkData, writeInkData } from './model';
export const storedInk = (doc: EditDoc, id: string) => (doc.elements[id]?.ovr.extensions?.ink as { value?: string } | undefined)?.value;
export function saveInk(doc: EditDoc, baselines: Record<string, Uint8Array>, created: Set<string>, changes: Record<string, Uint8Array | null>, generated = false) {
  const old = new Set([...created].filter((p) => /^ppt\/(ink|media)\/web-ppt-ink-/.test(p)));
  for (const p of old) { changes[p] = null; created.delete(p); }
  let types: ReturnType<typeof parseXmlTree> | undefined;
  const typeTree = () => {
    if (!types) {
      types = parseXmlTree(changes['[Content_Types].xml'] ?? sourcePartBytes(doc, '[Content_Types].xml')!);
      for (const n of children(types.root, 'Override')) if (old.has((attr(n, 'PartName') ?? '').slice(1))) removeXmlChild(types.root, n);
    }
    return types;
  };
  for (const record of Object.values(doc.elements)) {
    const raw = storedInk(doc, record.id); if (!raw) continue;
    const source = inkSource(doc, record.id); if (!source) throw new Error('墨迹来源丢失');
    const xml = writeInkData(source.xml, normalizeInkData(JSON.parse(raw))), hash = sha256(new TextEncoder().encode(record.id)).slice(0, 16);
    let data = `ppt/ink/web-ppt-ink-${hash}.xml`, preview = `ppt/media/web-ppt-ink-${hash}.svg`, index = 1;
    while (sourcePartBytes(doc, data) && !old.has(data) || sourcePartBytes(doc, preview) && !old.has(preview)) {
      data = `ppt/ink/web-ppt-ink-${hash}-${index}.xml`; preview = `ppt/media/web-ppt-ink-${hash}-${index++}.svg`;
    }
    let owner = record.parent; while (doc.elements[owner]) owner = doc.elements[owner].parent;
    const host = generated ? `ppt/slides/slide${doc.slideOrder.indexOf(owner) + 1}.xml` : source.host, rp = relPart(host);
    const originalHost = sourcePartBytes(doc, host), originalRels = sourcePartBytes(doc, rp);
    if (!generated) { if (originalHost) baselines[host] ??= originalHost; if (originalRels) baselines[rp] ??= originalRels; }
    const tree = parseXmlTree(changes[host] ?? originalHost!), rels = parseXmlTree(changes[rp] ?? originalRels!);
    for (const n of children(rels.root, 'Relationship')) if (attr(n, 'TargetMode') !== 'External' && old.has(resolvePart(host, attr(n, 'Target')!))) removeXmlChild(rels.root, n);
    const relation = (target: string, type: string) => {
      let id = 'webPptInk' + hash, count = 1;
      while (children(rels.root, 'Relationship').some((n) => attr(n, 'Id') === id)) id = 'webPptInk' + hash + '_' + count++;
      append(rels.root, createXmlElement('Relationship', { attributes: [['Id', id], ['Type', type], ['Target', '../' + target.slice(4)]] })); return id;
    };
    const dataRid = relation(data, `${R}/customXml`), previewRid = relation(preview, `${R}/image`);
    const pending = [tree.root], parents = new Map<XmlElement, XmlElement>(); let found = false;
    while (pending.length) {
      const n = pending.pop()!; for (const c of xmlElementChildren(n)) { parents.set(c, n); pending.push(c); }
      if (attr(n, 'webPptInkEdit') !== record.id) continue;
      found = true; const rid = n.attributes.find((a) => a.namespaceUri === R && a.localName === 'id');
      if (!rid) throw new Error('墨迹数据关系丢失'); setXmlAttribute(n, rid.name, dataRid); removeXmlAttribute(n, 'webPptInkEdit');
      let hostNode = parents.get(n); while (hostNode && hostNode.localName !== 'AlternateContent') hostNode = parents.get(hostNode);
      const fallback = hostNode && child(hostNode, 'Fallback'), fallbackNodes = fallback ? [fallback] : [];
      while (fallbackNodes.length) {
        const f = fallbackNodes.pop()!; fallbackNodes.push(...xmlElementChildren(f));
        if (f.localName === 'blip') {
          const embedded = f.attributes.find((a) => a.namespaceUri === R && a.localName === 'embed');
          if (embedded) setXmlAttribute(f, embedded.name, previewRid);
          for (const c of children(f, 'extLst')) removeXmlChild(f, c);
        }
      }
    }
    if (!found) throw new Error('保存找不到墨迹对象');
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const paths = renderInkXml(xml, record.src.w, record.src.h).map((s) => `<path transform="translate(${s.x} ${s.y})" d="${esc(s.path ?? '')}" fill="none" stroke="${esc(s.stroke!.color)}" stroke-width="${s.stroke!.width}" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${record.src.w}" height="${record.src.h}" viewBox="0 0 ${record.src.w} ${record.src.h}">${paths}</svg>`;
    changes[data] = new TextEncoder().encode(xml); changes[preview] = new TextEncoder().encode(svg); created.add(data); created.add(preview);
    changes[host] = serializeXmlTreeBytes(tree); changes[rp] = serializeXmlTreeBytes(rels);
    for (const [part, mime] of [[data, 'application/inkml+xml'], [preview, 'image/svg+xml']]) append(typeTree().root, createXmlElement('Override', { attributes: [['PartName', '/' + part], ['ContentType', mime]] }));
  }
  if (old.size) typeTree(); if (types) changes['[Content_Types].xml'] = serializeXmlTreeBytes(types);
}
