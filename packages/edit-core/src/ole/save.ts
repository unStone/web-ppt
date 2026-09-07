import { sourcePartBytes } from '@web-ppt/edit-core';
import type { EditDoc } from '@web-ppt/edit-core';
import { parseXmlTree, serializeXmlTreeBytes, xmlElementChildren, createXmlElement,
  insertXmlChildUnchecked as append, removeXmlChild, removeXmlAttribute, setXmlAttribute, cloneXmlNode as clone } from '@web-ppt/edit-core/xml';
import type { XmlElement } from '@web-ppt/edit-core/xml';
import { sha256 } from '../clipboard-binary';
import { objectSource } from '../object-source';
import { attr, child, children, R, relPart, resolvePart } from './container';
import { OLE, oleState, storedOle } from './state';
import { olePreviewSvg } from './preview';

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main', A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export function saveOle(doc: EditDoc, baselines: Record<string, Uint8Array>, created: Set<string>, changes: Record<string, Uint8Array | null>, generated = false) {
  const old = new Set([...created].filter((p) => p.startsWith('ppt/media/web-ppt-ole-') || p.startsWith('ppt/embeddings/web-ppt-ole-')));
  for (const part of old) { changes[part] = null; created.delete(part); }
  const typesPart = '[Content_Types].xml';
  let types: ReturnType<typeof parseXmlTree> | undefined;
  const typeTree = () => {
    if (!types) {
      types = parseXmlTree(changes[typesPart] ?? sourcePartBytes(doc, typesPart)!);
      for (const n of children(types.root, 'Override')) if (old.has((attr(n, 'PartName') ?? '').slice(1))) removeXmlChild(types.root, n);
    }
    return types;
  };
  for (const record of Object.values(doc.elements)) {
    const source = objectSource(doc, record.id, OLE); if (!source) continue;
    const raw = storedOle(doc, record.id);
    if (!raw) continue;
    const state = oleState(doc, record.id), svg = olePreviewSvg(state.content), svgBytes = new TextEncoder().encode(svg);
    const identity = sha256(new TextEncoder().encode(record.id)).slice(0, 16), suffix = source.part.split('.').pop()!;
    let embeddedPart = `ppt/embeddings/web-ppt-ole-${identity}.${suffix}`, embeddedIndex = 1;
    while (sourcePartBytes(doc, embeddedPart) && !old.has(embeddedPart)) embeddedPart = `ppt/embeddings/web-ppt-ole-${identity}-${embeddedIndex++}.${suffix}`;
    changes[embeddedPart] = state.pkg.wrap(state.changes); created.add(embeddedPart);
    let owner = record.parent; while (doc.elements[owner]) owner = doc.elements[owner].parent;
    const host = generated ? `ppt/slides/slide${doc.slideOrder.indexOf(owner) + 1}.xml` : source.hostPart;
    const hostBytes = sourcePartBytes(doc, host), relsPart = relPart(host), relsBytes = sourcePartBytes(doc, relsPart);
    if (!generated) { if (hostBytes) baselines[host] ??= hostBytes; if (relsBytes) baselines[relsPart] ??= relsBytes; }
    const tree = parseXmlTree(changes[host] ?? hostBytes!), rels = parseXmlTree(changes[relsPart] ?? relsBytes!);
    for (const relation of children(rels.root, 'Relationship')) {
      if (attr(relation, 'TargetMode') !== 'External' && old.has(resolvePart(host, attr(relation, 'Target') ?? ''))) removeXmlChild(rels.root, relation);
    }
    const hash = sha256(svgBytes).slice(0, 16); let part = `ppt/media/web-ppt-ole-${hash}.svg`, serial = 1;
    while (sourcePartBytes(doc, part) && !old.has(part)) part = `ppt/media/web-ppt-ole-${hash}-${serial++}.svg`;
    let rid = `webPptOle${hash}`, index = 1;
    while (children(rels.root, 'Relationship').some((n) => attr(n, 'Id') === rid)) rid = `webPptOle${hash}_${index++}`;
    append(rels.root, createXmlElement('Relationship', { attributes: [['Id', rid], ['Type', `${R}/image`], ['Target', '../media/' + part.split('/').pop()!]] }));
    const pending: XmlElement[] = [tree.root], objects: XmlElement[] = []; let maxId = 1;
    while (pending.length) {
      const n = pending.pop()!; pending.push(...xmlElementChildren(n));
      if (n.localName === 'cNvPr') maxId = Math.max(maxId, Number(attr(n, 'id')) || 1);
      if (n.namespaceUri === P && n.localName === 'oleObj' && attr(n, 'webPptOleEdit') === record.id) objects.push(n);
    }
    if (!objects.length) throw new Error('保存找不到 OLE 原生对象');
    const sourceTypes = parseXmlTree(sourcePartBytes(doc, typesPart)!);
    const nativeType = children(sourceTypes.root, 'Override').find((n) => attr(n, 'PartName') === '/' + source.part)
      ?? children(sourceTypes.root, 'Default').find((n) => attr(n, 'Extension') === suffix);
    if (!nativeType) throw new Error('OLE 原生类型声明不存在');
    append(typeTree().root, createXmlElement('Override', { attributes: [['PartName', '/' + embeddedPart], ['ContentType', attr(nativeType, 'ContentType')!]] }));
    for (const object of objects) {
      const originalRid = object.attributes.find((a) => a.namespaceUri === R && a.localName === 'id');
      const nativeRel = children(rels.root, 'Relationship').find((n) => attr(n, 'Id') === originalRid?.value);
      if (!nativeRel || !originalRid) throw new Error('OLE 原生关系不存在');
      let nativeId = `webPptOleData${identity}`, next = 1;
      while (children(rels.root, 'Relationship').some((n) => attr(n, 'Id') === nativeId)) nativeId = `webPptOleData${identity}_${next++}`;
      append(rels.root, createXmlElement('Relationship', { attributes: [['Id', nativeId], ['Type', attr(nativeRel, 'Type')!], ['Target', '../embeddings/' + embeddedPart.split('/').pop()!]] }));
      setXmlAttribute(object, originalRid.name, nativeId); removeXmlAttribute(object, 'webPptOleEdit');
      const original = child(object, 'pic'); if (original) removeXmlChild(object, original);
      const markup = `<p:pic xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"><p:nvPicPr><p:cNvPr id="${++maxId}" name="OLE 内容预览"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(record.src.w * 9525)}" cy="${Math.round(record.src.h * 9525)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
      const pic = parseXmlTree(markup).root;
      // 新建元素不能直接从另一棵树摘根，按公开克隆器建立独立节点。
      append(object, clone(pic));
    }
    changes[host] = serializeXmlTreeBytes(tree); changes[relsPart] = serializeXmlTreeBytes(rels);
    changes[part] = svgBytes; created.add(part);
    const t = typeTree(); if (!children(t.root, 'Override').some((n) => attr(n, 'PartName') === '/' + part)) append(t.root, createXmlElement('Override', { attributes: [['PartName', '/' + part], ['ContentType', 'image/svg+xml']] }));
  }
  if (old.size) typeTree();
  if (types) changes[typesPart] = serializeXmlTreeBytes(types);
}
