import { sourcePartBytes, effectiveElement } from '@web-ppt/edit-core';
import type { EditDoc } from '@web-ppt/edit-core';
import { layoutDiagramXml } from '@web-ppt/core/diagram-edit';
import { parseXmlTree, serializeXmlTreeBytes, createXmlElement, insertXmlChildUnchecked as append,
  removeXmlChild, setXmlAttribute, xmlElementChildren } from '@web-ppt/edit-core/xml';
import { objectSource } from '../object-source';
import { relativeTarget, relationshipPartFor, resolveRelationshipTarget } from '../clipboard-source';
import { chartRelationships } from '../chart/context';
import { DGM, DSP, attr, child, children, readSmartArtNodes, writeSmartArtNodes, smartArtIdentity } from './model';
import { smartArtDrawing } from './drawing';

const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const TYPE = 'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing';
export const storedSmartArt = (doc: EditDoc, id: string) => (doc.elements[id]?.ovr.extensions?.smartart as { value?: string } | undefined)?.value;

export function saveSmartArt(doc: EditDoc, baselines: Record<string, Uint8Array>, created: Set<string>,
  changes: Record<string, Uint8Array | null>, generated = false): void {
  const existing = new Set([...created].filter((name) => name.startsWith('ppt/diagrams/') && name.includes('/web-ppt-drawing-')));
  for (const part of existing) { changes[part] = null; created.delete(part); }
  const typesPart = '[Content_Types].xml';
  let types: ReturnType<typeof parseXmlTree> | undefined;
  const contentTypes = () => {
    if (!types) {
      types = parseXmlTree(changes[typesPart] ?? doc.package!.parts[typesPart]);
      for (const old of children(types.root, 'Override')) if (existing.has((attr(old, 'PartName') ?? '').slice(1))) removeXmlChild(types.root, old);
    }
    return types;
  };
  const relTrees = new Map<string, ReturnType<typeof parseXmlTree>>();
  const written = new Map<string, { value: string; xml: Uint8Array; drawing: string; rid: string }>();
  for (const record of Object.values(doc.elements)) {
    const source = objectSource(doc, record.id, DGM, 'dm'); if (!source) continue;
    const value = storedSmartArt(doc, record.id);
    const tracked = !!doc.saveState.baselines[source.part];
    if (!value && !tracked && !generated) continue;
    let owner = record.parent; while (doc.elements[owner]) owner = doc.elements[owner].parent;
    const host = generated ? `ppt/slides/slide${doc.slideOrder.indexOf(owner) + 1}.xml` : source.hostPart;
    const relPart = relationshipPartFor(host), baselineRels = sourcePartBytes(doc, relPart);
    const rels = relTrees.get(relPart) ?? parseXmlTree(changes[relPart] ?? baselineRels ?? `<Relationships xmlns="${REL}"/>`);
    relTrees.set(relPart, rels);
    if (baselineRels && !generated) baselines[relPart] ??= baselineRels;
    for (const relation of children(rels.root, 'Relationship')) {
      const target = attr(relation, 'Target') ?? '';
      if ([...existing].some((p) => target === relativeTarget(host, p))) removeXmlChild(rels.root, relation);
    }
    if (!generated) baselines[source.part] ??= sourcePartBytes(doc, source.part)!;
    if (!value && !generated) { changes[source.part] = baselines[source.part]; continue; }
    const nodes = value ? JSON.parse(value) : readSmartArtNodes(source.xml);
    const signature = value ?? JSON.stringify(nodes);
    const previous = written.get(source.part);
    if (previous) {
      if (previous.value !== signature) throw new Error('共享 SmartArt 不能设置不同结构');
      const match = children(rels.root, 'Relationship').find((n) => attr(n, 'Id') === previous.rid);
      if (match) {
        if (attr(match, 'Type') !== TYPE || attr(match, 'Target') !== relativeTarget(host, previous.drawing)) throw new Error('共享 SmartArt 绘图关系身份冲突');
        continue;
      }
      append(rels.root, createXmlElement('Relationship', { attributes: [['Id', previous.rid], ['Type', TYPE], ['Target', relativeTarget(host, previous.drawing)]] }));
      continue;
    }
    const text = (part: string | undefined) => part ? new TextDecoder().decode(sourcePartBytes(doc, part)) : undefined;
    const relationships = chartRelationships(doc, source.hostPart);
    const sourceModel = parseXmlTree(source.xml).root;
    const extensions = children(child(sourceModel, 'extLst'), 'ext').flatMap((node) => xmlElementChildren(node));
    const pointer = extensions.find((node) => node.namespaceUri === DSP && node.localName === 'dataModelExt');
    const cached = relationships[attr(pointer ?? null, 'relId') ?? '']?.target
      ?? Object.values(relationships).find((r) => r.type === TYPE)?.target;
    if (!value && !cached) continue;
    const data = value ? writeSmartArtNodes(source.xml, nodes) : source.xml, frame = effectiveElement(doc, record.id);
    const layout = layoutDiagramXml(data, text(source.references.lo), text(source.references.cs), frame.w, frame.h, source.context);
    const prefix = smartArtIdentity(source.part).replace(/[^\da-f]/gi, '').slice(0, 12).toLowerCase();
    let drawing = `ppt/diagrams/web-ppt-drawing-${prefix}.xml`, suffix = 1;
    while (sourcePartBytes(doc, drawing) && !existing.has(drawing)) drawing = `ppt/diagrams/web-ppt-drawing-${prefix}-${suffix++}.xml`;
    let rid = `webPptSmartArt${prefix}`, idIndex = 1;
    while (children(rels.root, 'Relationship').some((n) => attr(n, 'Id') === rid)) rid = `webPptSmartArt${prefix}_${idIndex++}`;
    append(rels.root, createXmlElement('Relationship', { attributes: [['Id', rid], ['Type', TYPE], ['Target', relativeTarget(host, drawing)]] }));
    const model = parseXmlTree(data);
    let extList = child(model.root, 'extLst'); if (!extList) { extList = createXmlElement('dgm:extLst', { attributes: [['xmlns:dgm', DGM]] }); append(model.root, extList); }
    let ext = children(extList, 'ext').find((node) => attr(node, 'uri') === DSP);
    if (!ext) { ext = createXmlElement('dgm:ext', { attributes: [['xmlns:dgm', DGM], ['uri', DSP]] }); append(extList, ext); }
    let block = xmlElementChildren(ext).find((node) => node.namespaceUri === DSP && node.localName === 'dataModelExt');
    if (!block) { block = createXmlElement('dsp:dataModelExt', { attributes: [['xmlns:dsp', DSP]] }); append(ext, block); }
    setXmlAttribute(block, 'relId', rid); setXmlAttribute(block, 'minVer', DGM);
    const xml = serializeXmlTreeBytes(model);
    changes[source.part] = xml;
    changes[drawing] = !value && cached ? sourcePartBytes(doc, cached)! : smartArtDrawing(data, layout.elements, layout.nodes, nodes);
    created.add(drawing);
    const relatedSource = !value && cached ? cached : source.part;
    const related = sourcePartBytes(doc, relationshipPartFor(relatedSource));
    if (related) {
      const dependencies = parseXmlTree(related);
      for (const relation of children(dependencies.root, 'Relationship')) if (attr(relation, 'TargetMode') !== 'External') {
        setXmlAttribute(relation, 'Target', relativeTarget(drawing, resolveRelationshipTarget(relatedSource, attr(relation, 'Target')!)));
      }
      const path = relationshipPartFor(drawing); changes[path] = serializeXmlTreeBytes(dependencies); created.add(path);
    }
    written.set(source.part, { value: signature, xml, drawing, rid });
    const types = contentTypes();
    append(types.root, createXmlElement('Override', { attributes: [['PartName', `/${drawing}`], ['ContentType', 'application/vnd.ms-office.drawingml.diagramDrawing+xml']] }));
  }
  if (existing.size && !types) {
    contentTypes();
  }
  for (const [part, tree] of relTrees) changes[part] = serializeXmlTreeBytes(tree);
  if (types) changes[typesPart] = serializeXmlTreeBytes(types);
}
