import { textOverride } from './text-override';
import type { GeneratedTextContext } from './text-override';
import { generatedTextBody } from './text-body';
import { registeredEditExtensions } from '../extension-runtime';
import { relativeTarget } from '../clipboard-source';
import { elementOrder } from '../element-order';
import { effectiveElement, toSlide } from '../projection';
import { supportsElementLink } from '../hyperlink';
import { queryElementAltText } from '../alt-text';
import { insertionResourceToken } from '../session-assets';
import { querySlideAnimations } from '../slide-animation';
import { effectivePresetGeometry } from '../preset-geometry';
import { tableCellKey } from '../table-cell';
import type {
  EditDoc, ElementInsertionResource, ElementInsertionSource,
  ElementOverrides, ElementRecord, SlideId,
} from '../types';
import { DRAWINGML_NS, OFFICE_RELATIONSHIPS_NS, PRESENTATIONML_NS } from '../xml/qname';
import { parseXmlTree, serializeXmlTreeBytes } from '../xml/tree';
import {
  mediaPackageParts, patchContentTypes, patchRelationshipPart, relationshipPartFor, resourceBytes,
} from '../save/clipboard-parts';
import { materializeElementTreeState } from '../save/insertion';
import { createGeneratedNotesPart } from '../save/notes';
import {
  createHyperlinkSaveContext, patchHyperlinkRelationshipPart,
} from '../save/hyperlink';
import type { HyperlinkSaveContext } from '../save/hyperlink';
import { materializeElementImageFill, materializeElementStroke } from '../save/shape-format';
import { patchSlideProperties } from '../save/slide-properties';
import { extensionSupportsGenerated, materializeElementExtensions } from '../save/extension-elements';
import {
  materializeTableStyles, patchTableStyleContentType, patchTableStylePresentationRelationships,
} from '../save/table-style-part';
import { customGeometryMarkup } from './custom-geometry';
import { generatedLink } from './links';
import { imageClosure, imageInsertion } from './media';
import { generatedTableStyleDefinitions, tableInsertion } from './table';
import { generatedEmptySlideXml, generatedTemplateParts } from './template';
import { patchGeneratedPresentationMetadata } from '../save/slide-parts';
import { effectiveTheme } from '../theme';
import { allocatedProjectionSpids, generatedProjectionTree } from './projection-tree';
import { materializeGeneratedMasterDefaults } from './master-defaults';
import { CompatibilityParts } from './compatibility-parts';
import { compatibilityInsertion } from './compatibility';
import { materializeGeneratedComments } from './comments';

const esc = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const NOTES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide';
const NOTES_MASTER_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster';
const SLIDE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';

function fullOverrides(
  doc: EditDoc,
  slideId: SlideId,
  record: ElementRecord,
  part: string,
  resources: Map<string, ElementInsertionResource>,
): ElementOverrides {
  const source = record.src;
  const altText = doc.elements[record.id]
    ? queryElementAltText(doc, record.id)
    : {
      title: source.editInfo?.altText?.title ?? '',
      descr: source.editInfo?.altText?.descr ?? '',
    };
  const common: ElementOverrides = {
    x: source.x, y: source.y, w: source.w, h: source.h,
    rot: source.rot, flipH: source.flipH, flipV: source.flipV,
    ...(source.name ? { name: source.name } : {}),
    ...(source.effects ? { effects: source.effects } : {}),
    ...(altText.title || altText.descr ? {
      altText: { title: altText.title, descr: altText.descr },
    } : {}),
    ...(source.link && supportsElementLink(source.kind)
      ? { link: generatedLink(doc, slideId, source.link, `元素 ${record.id} 链接`) } : {}),
  };
  const textContext = (suffix = ''): GeneratedTextContext => ({
    part, relationshipPrefix: `rIdBullet${record.meta.origin?.spid ?? record.id}${suffix}`, resources,
  });
  if (source.kind === 'shape') {
    const text = textOverride(doc, slideId, source.text, textContext());
    return {
      ...common,
      ...(source.fill && source.fill.type !== 'image' ? { fill: source.fill } : {}),
      ...(text ? { text } : {}),
    };
  }
  if (source.kind === 'image') {
    return { ...common, ...(source.crop ? { crop: source.crop } : {}) };
  }
  if (source.kind === 'table') {
    const tableCells: NonNullable<ElementOverrides['tableCells']> = {};
    source.rows.forEach((row, r) => row.cells.forEach((cell, c) => {
      const text = !cell.merged && textOverride(
        doc, slideId, cell.text, textContext(`R${r + 1}C${c + 1}`),
        !!source.editInfo?.tableStyle && !!cell.editInfo?.styleBase,
      );
      if (text) tableCells[tableCellKey({ r, c })] = { text };
    }));
    return { ...common, ...(Object.keys(tableCells).length ? { tableCells } : {}) };
  }
  return common;
}

function shapeInsertion(
  doc: EditDoc,
  record: ElementRecord,
  spid: number,
  part: string,
): ElementInsertionSource {
  const source = record.src;
  if (source.kind !== 'shape') throw new Error(`生成保存暂不支持元素类型：${source.kind}`);
  const geom = record.meta.geom;
  const preset = geom?.preset;
  const guides = Object.entries((geom?.adj ?? {}) as Readonly<Record<string, number>>)
    .map(([name, value]) => {
    if (!Number.isSafeInteger(Math.round(value))) throw new Error(`形状 ${record.id} 的几何调整值无效`);
    return `<a:gd name="${esc(name)}" fmla="val ${Math.round(value)}"/>`;
    }).join('');
  const text = source.text ? generatedTextBody(source.text, part, spid) : '';
  const name = esc(source.name ?? `形状 ${spid}`);
  const textBox = source.path === null;
  const geometry = textBox ? '' : preset
    ? `<a:prstGeom prst="${esc(preset)}"><a:avLst>${guides}</a:avLst></a:prstGeom>`
    : customGeometryMarkup(source.path!, source.w, source.h, !!source.openGeom);
  const fillClosure = source.fill?.type === 'image'
    ? imageClosure(doc, source.fill, `rIdFill${spid}`, part) : null;
  if (fillClosure && !fillClosure.resource) {
    throw new Error(`形状 ${record.id} 的外链图片填充不能生成独立包`);
  }
  return {
    markup: `<p:sp><p:nvSpPr><p:cNvPr id="${spid}" name="${name}"/><p:cNvSpPr${textBox ? ' txBox="1"' : ''}/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm/>${geometry}</p:spPr>${text}</p:sp>`,
    namespaces: { 'xmlns:a': DRAWINGML_NS, 'xmlns:p': PRESENTATIONML_NS, 'xmlns:r': OFFICE_RELATIONSHIPS_NS },
    spids: { [String(spid)]: spid },
    ...(fillClosure ? { relationships: [fillClosure.relationship] } : {}),
    ...(fillClosure?.resource ? { resources: [fillClosure.resource] } : {}),
  };
}

function groupCoordinate(value: number, label: string): string {
  const result = Math.round(value * 9525);
  if (!Number.isSafeInteger(result)) throw new Error(`组合 ${label} 超出 OOXML 安全整数范围`);
  return String(result);
}

function groupInsertion(record: ElementRecord, spid: number): ElementInsertionSource {
  const source = record.src;
  if (source.kind !== 'group') throw new Error(`元素 ${record.id} 不是组合`);
  const childWidth = source.w / source.scaleX;
  const childHeight = source.h / source.scaleY;
  const name = esc(source.name ?? `组合 ${spid}`);
  return {
    markup: `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${spid}" name="${name}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="${groupCoordinate(source.x, 'x')}" y="${groupCoordinate(source.y, 'y')}"/>
<a:ext cx="${groupCoordinate(source.w, 'w')}" cy="${groupCoordinate(source.h, 'h')}"/>
<a:chOff x="${groupCoordinate(source.childX, 'childX')}" y="${groupCoordinate(source.childY, 'childY')}"/>
<a:chExt cx="${groupCoordinate(childWidth, 'childWidth')}" cy="${groupCoordinate(childHeight, 'childHeight')}"/>
</a:xfrm></p:grpSpPr></p:grpSp>`,
    namespaces: { 'xmlns:a': DRAWINGML_NS, 'xmlns:p': PRESENTATIONML_NS },
    spids: { [String(spid)]: spid },
  };
}

/** 未建模旧格式不能悄悄变成普通矩形；生成包保留预览和带原因的明示框架占位。 */
function unsupportedInsertion(
  doc: EditDoc,
  record: ElementRecord,
  spid: number,
  part: string,
): ElementInsertionSource {
  const source = record.src;
  if (source.kind !== 'unsupported') throw new Error(`元素 ${record.id} 不是框架占位`);
  const name = esc(source.name ?? `未支持对象 ${spid}`);
  const label = esc(source.label).replace(/>/g, '&gt;');
  const preview = source.preview
    ? imageClosure(doc, { src: source.preview, name: source.name, id: source.id }, `rIdUnsupportedPreview${spid}`, part)
    : null;
  if (preview && !preview.resource) throw new Error(`框架占位 ${record.id} 的外链预览不能生成独立包`);
  const fill = preview
    ? `<a:blipFill><a:blip r:embed="${preview.relationship.targetId}"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>`
    : '<a:solidFill><a:srgbClr val="F2F2F2"/></a:solidFill>';
  return {
    markup: `<p:sp><p:nvSpPr><p:cNvPr id="${spid}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm/><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
${fill}<a:ln w="12700"><a:solidFill><a:srgbClr val="AAAAAA"/></a:solidFill><a:prstDash val="dash"/></a:ln></p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="zh-CN" sz="1200"><a:solidFill><a:srgbClr val="777777"/></a:solidFill></a:rPr><a:t>${label}</a:t></a:r><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp>`,
    namespaces: {
      'xmlns:a': DRAWINGML_NS, 'xmlns:p': PRESENTATIONML_NS,
      ...(preview ? { 'xmlns:r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships' } : {}),
    },
    spids: { [String(spid)]: spid },
    ...(preview ? { relationships: [preview.relationship] } : {}),
    ...(preview?.resource ? { resources: [preview.resource] } : {}),
  };
}

function elementInsertion(
  doc: EditDoc,
  record: ElementRecord,
  spid: number,
  part: string,
): ElementInsertionSource {
  if (record.src.editInfo?.requiresOriginal) {
    throw new Error(`兼容对象 ${record.id} 需要原包；请重新打开原文件并使用补丁保存`);
  }
  if (record.src.scene3d && !extensionSupportsGenerated(record.src)) throw new Error(`生成保存暂不支持三维元素：${record.id}`);
  if (record.src.kind === 'image' && (record.src.filter || record.src.duotone) && !extensionSupportsGenerated(record.src)) {
    throw new Error(`生成保存暂不支持图片滤镜：${record.id}`);
  }
  if (record.src.kind === 'shape') return shapeInsertion(doc, record, spid, part);
  if (record.src.kind === 'image') return imageInsertion(doc, record, spid, part);
  if (record.src.kind === 'table') return tableInsertion(record, spid);
  if (record.src.kind === 'group') return groupInsertion(record, spid);
  if (record.src.kind === 'unsupported') return unsupportedInsertion(doc, record, spid, part);
  const unknown: never = record.src;
  throw new Error(`生成保存遇到未知元素类型：${String(unknown)}`);
}

function materializeSlide(
  doc: EditDoc,
  slideId: SlideId,
  index: number,
  relationshipSource: Uint8Array,
  compatibility: CompatibilityParts,
): { bytes: Uint8Array; work: EditDoc; links: HyperlinkSaveContext } {
  const part = `ppt/slides/slide${index + 1}.xml`;
  const projectionTree = generatedProjectionTree(doc, slideId);
  const spids = allocatedProjectionSpids(projectionTree.sourceRecords, projectionTree.roots);
  const usedSpids = new Set([1, ...spids.values()]);
  const records: Record<string, ElementRecord> = Object.create(null);
  const generatedTextResources = new Map<string, ElementInsertionResource>();
  for (const [id, sourceRecord] of Object.entries(projectionTree.sourceRecords)) {
    let ancestor = projectionTree.sourceRecords[sourceRecord.parent];
    let opaque = false;
    while (ancestor) {
      if (ancestor.src.editInfo?.requiresOriginal) { opaque = true; break; }
      ancestor = projectionTree.sourceRecords[ancestor.parent];
    }
    if (opaque) continue;
    const source = structuredClone(doc.elements[id] ? effectiveElement(doc, id) : sourceRecord.src);
    const presetGeometry = source.kind === 'shape'
      ? doc.elements[id]
        ? effectivePresetGeometry(doc, id)
        : source.editInfo?.geom ?? sourceRecord.meta.geom ?? null
      : null;
    const record: ElementRecord = {
      ...structuredClone(sourceRecord), src: source, ovr: {},
      meta: {
        ...structuredClone(sourceRecord.meta), editable: 'full', created: true,
        inherited: undefined, origin: { part, spid: spids.get(id)! },
        ...(source.kind === 'shape' ? {
          geom: presetGeometry ?? undefined,
          customGeometry: presetGeometry ? undefined : sourceRecord.meta.customGeometry,
        } : {}),
      },
    };
    if (sourceRecord.src.editInfo?.requiresOriginal) {
      record.meta.editable = 'frame';
      record.meta.insertion = compatibilityInsertion(doc, sourceRecord, part, spids.get(id)!, usedSpids, compatibility);
      record.children = undefined;
      record.ovr = { ...structuredClone(sourceRecord.ovr), x: source.x, y: source.y, w: source.w, h: source.h };
    } else {
      // 有效投影已经吸收图片/海报替换；新宿主必须使用新关系，不能再重放旧包的 rId。
      record.meta.imageReplacement = undefined;
      try {
        record.meta.insertion = elementInsertion(doc, record, spids.get(id)!, part);
        record.ovr = fullOverrides(doc, slideId, record, part, generatedTextResources);
      } catch (error) {
        throw new Error(`元素 ${id}（${source.name ?? source.kind}）：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    records[id] = record;
  }
  const slide = structuredClone(doc.slides[slideId]);
  slide.origin = { part };
  const projection = toSlide(doc, slideId);
  const background = projection.background;
  const backgroundClosure = background?.type === 'image'
    ? imageClosure(doc, background, 'rIdBackground', part) : null;
  if (backgroundClosure && !backgroundClosure.resource) {
    throw new Error(`页面 ${slideId} 的外链图片背景不能生成独立包`);
  }
  if (background?.type === 'image' && backgroundClosure?.resource) {
    const src = insertionResourceToken(backgroundClosure.resource.hash);
    slide.backgroundImage = {
      src,
      relationships: [backgroundClosure.relationship],
      resourceHash: backgroundClosure.resource.hash,
      resourceHashes: [backgroundClosure.resource.hash],
      imageRelationshipId: backgroundClosure.relationship.targetId,
    };
  }
  const animations = querySlideAnimations(doc, [slideId]).value;
  const backgroundOverride = background?.type === 'image' && backgroundClosure?.resource
    ? { ...background, src: insertionResourceToken(backgroundClosure.resource.hash) }
    : background;
  slide.ovr = {
    ...(backgroundOverride ? { background: backgroundOverride } : {}),
    hidden: !!projection.hidden,
    ...(projection.transition ? { transition: projection.transition } : {}),
    ...(animations.length ? { animations } : {}),
  };
  const slides = Object.fromEntries(doc.slideOrder.map((id, slideIndex) => {
    const generated = structuredClone(doc.slides[id]);
    generated.origin = { part: `ppt/slides/slide${slideIndex + 1}.xml` };
    delete generated.backgroundImage;
    return [id, generated];
  }));
  slides[slideId] = slide;
  const work: EditDoc = {
    ...structuredClone({ ...doc, package: null }),
    slides, elements: records,
    imageResources: {
      ...structuredClone(doc.imageResources),
      ...Object.fromEntries(generatedTextResources),
      ...(backgroundClosure?.resource
        ? { [backgroundClosure.resource.hash]: backgroundClosure.resource } : {}),
    },
    removedElements: {}, package: null,
  };
  const roots = [...projectionTree.roots].sort((left, right) =>
    elementOrder(records[left]).localeCompare(elementOrder(records[right])));
  slide.children = roots;
  const tree = parseXmlTree(generatedEmptySlideXml());
  const additions = Object.values(records).flatMap((record) =>
    record.meta.insertion?.relationships ?? []);
  if (backgroundClosure) additions.push(backgroundClosure.relationship);
  const links = createHyperlinkSaveContext(work, part, relationshipSource, additions);
  materializeElementTreeState(tree, work, part, roots.map((id) => records[id]), [], { links });
  patchSlideProperties(tree, work, slide);
  for (const record of Object.values(records)) {
    if (record.src.editInfo?.requiresOriginal) continue;
    materializeElementExtensions(tree, record, true);
    if (record.src.kind === 'shape' && record.src.fill?.type === 'image') {
      materializeElementImageFill(tree, record, record.src.fill, `rIdFill${spids.get(record.id)!}`);
    }
    if (record.src.kind === 'shape' || record.src.kind === 'image') {
      materializeElementStroke(tree, record, record.src.stroke ?? null);
    }
  }
  return { bytes: serializeXmlTreeBytes(tree), work, links };
}

export function materializeGeneratedParts(doc: EditDoc, observe?: (slideId: SlideId, work: EditDoc) => void): Record<string, Uint8Array> {
  const projections = doc.slideOrder.map((slideId) => toSlide(doc, slideId));
  const notesSlides = doc.slideOrder.map((slideId, index) =>
    !!doc.slides[slideId].notes || projections[index].notes !== undefined);
  const firstLayout = doc.slides[doc.slideOrder[0]]?.layoutId;
  const themeId = (firstLayout ? doc.layouts[firstLayout]?.themeId : undefined) ?? doc.themeOrder[0];
  const themeRecord = themeId ? doc.themes[themeId] : undefined;
  const theme = themeRecord ? { id: themeRecord.id, name: themeRecord.name, ...effectiveTheme(themeRecord) } : undefined;
  const parts = generatedTemplateParts(
    doc.meta.width, doc.meta.height, doc.slideOrder.length, notesSlides, theme,
  );
  materializeGeneratedMasterDefaults(doc, projections, parts);
  const tableStyles = generatedTableStyleDefinitions(doc);
  if (tableStyles.length) {
    const part = 'ppt/tableStyles.xml';
    parts[part] = materializeTableStyles(undefined, tableStyles);
    parts['[Content_Types].xml'] = patchTableStyleContentType(parts['[Content_Types].xml'], part);
    parts['ppt/_rels/presentation.xml.rels'] = patchTableStylePresentationRelationships(
      parts['ppt/_rels/presentation.xml.rels'], part,
    );
  }
  const resources = new Map<string, ElementInsertionResource>();
  const compatibility = new CompatibilityParts(doc);
  doc.slideOrder.forEach((slideId, index) => {
    const slidePart = `ppt/slides/slide${index + 1}.xml`;
    const relsPart = relationshipPartFor(slidePart);
    const materialized = materializeSlide(doc, slideId, index, parts[relsPart], compatibility);
    parts[slidePart] = materialized.bytes;
    observe?.(slideId, materialized.work);
    const media = mediaPackageParts(materialized.work);
    for (const [part, relationships] of media.relationships) {
      const targetRelsPart = relationshipPartFor(part);
      parts[targetRelsPart] = part === slidePart
        ? patchHyperlinkRelationshipPart(
          parts[targetRelsPart], relationships, materialized.links, materialized.bytes,
        )
        : patchRelationshipPart(parts[targetRelsPart], relationships);
    }
    for (const [part, resource] of media.resources) {
      const previous = resources.get(part);
      if (previous && previous.hash !== resource.hash) throw new Error(`生成媒体 part 冲突：${part}`);
      resources.set(part, resource);
    }
    if (notesSlides[index]) {
      const notesPart = `ppt/notesSlides/notesSlide${index + 1}.xml`;
      parts[notesPart] = createGeneratedNotesPart(projections[index].notes ?? '');
      parts[relationshipPartFor(notesPart)] = patchRelationshipPart(undefined, [{
        sourceId: 'rId1', targetId: 'rId1', type: NOTES_MASTER_REL,
        target: relativeTarget(notesPart, 'ppt/notesMasters/notesMaster1.xml'),
      }, {
        sourceId: 'rId2', targetId: 'rId2', type: SLIDE_REL,
        target: relativeTarget(notesPart, slidePart),
      }]);
      parts[relsPart] = patchRelationshipPart(parts[relsPart], [{
        sourceId: 'rIdNotes', targetId: 'rIdNotes', type: NOTES_REL,
        target: relativeTarget(slidePart, notesPart),
      }]);
    }
  });
  for (const [part, resource] of resources) parts[part] = resourceBytes(resource);
  parts['[Content_Types].xml'] = patchContentTypes(
    parts['[Content_Types].xml'], [...resources.values()],
  );
  parts['ppt/presentation.xml'] = patchGeneratedPresentationMetadata(
    parts['ppt/presentation.xml'], doc,
  );
  compatibility.mergeInto(parts);
  for (const extension of registeredEditExtensions().values()) extension.generateParts?.(doc, parts);
  materializeGeneratedComments(parts, projections);
  return parts;
}
