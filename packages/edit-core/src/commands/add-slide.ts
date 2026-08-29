import { allocateSlideId } from '../document';
import { assertDataObject, own } from '../data-validation';
import type { EditDoc } from '../types';
import { allocateSlideOpcIdentity, presentationSlideIdForPart } from './add-slide-identity';
import { layoutTemplateRecords } from './add-slide-template';
import type { AddSlideCommand, CommandPatches, SlideTreePatch } from './types';

function assertCommand(doc: EditDoc, command: AddSlideCommand) {
  if (doc.meta.readonly || doc.meta.source !== 'pptx' || !doc.package) {
    throw new Error('只读或非 OOXML 编辑文档不能新增页面');
  }
  if (typeof command.layoutId !== 'string' || !command.layoutId) throw new Error('AddSlide.layoutId 必须是非空字符串');
  const layout = doc.layouts[command.layoutId];
  if (!layout) throw new Error(`找不到版式：${command.layoutId}`);
  assertDataObject(command.at, ['after'], 'AddSlide.at');
  if (!own(command.at, 'after')
    || (command.at.after !== null && (typeof command.at.after !== 'string' || !doc.slides[command.at.after]))) {
    throw new Error(`AddSlide.at.after 指向不存在的页面：${String(command.at.after)}`);
  }
  return layout;
}

export function addSlidePatches(doc: EditDoc, command: AddSlideCommand, origin: string): CommandPatches {
  const layout = assertCommand(doc, command);
  const slideId = allocateSlideId(doc);
  const opc = allocateSlideOpcIdentity(doc);
  const template = layoutTemplateRecords(doc, layout, slideId, opc.part);
  doc.identity.nextSpid[opc.part] = template.nextSpid;
  const afterPart = command.at.after ? doc.slides[command.at.after]!.origin?.part : undefined;
  const afterIndex = command.at.after === null ? -1 : doc.slideOrder.indexOf(command.at.after);
  const value = {
    after: command.at.after,
    before: doc.slideOrder[afterIndex + 1] ?? null,
    slide: {
      id: slideId,
      src: {
        background: structuredClone(layout.background),
        layoutName: layout.name,
        ...(layout.transition ? { transition: structuredClone(layout.transition) } : {}),
      },
      ovr: {}, children: template.children, dynamicSlideNumbers: template.dynamicSlideNumbers,
      dynamicSlideLinks: template.dynamicSlideLinks,
      origin: { part: opc.part }, layoutId: layout.id, sourceLayoutId: layout.id,
      defaultShape: structuredClone(layout.defaultShape),
      ...(layout.defaultTable ? { defaultTable: structuredClone(layout.defaultTable) } : {}),
      ...(layout.tableStyles ? { tableStyles: structuredClone(layout.tableStyles) } : {}),
      creation: {
        layoutPart: layout.origin.part,
        layoutRelationshipId: 'rId1',
        presentationSlideId: opc.presentationSlideId,
        presentationRelationshipId: opc.presentationRelationshipId,
        ...(afterPart ? { sectionAfterSlideId: presentationSlideIdForPart(doc, afterPart) } : {}),
      },
    },
    records: template.records,
  };
  const path = ['slides', slideId] as const;
  const forward: SlideTreePatch = { op: 'insert', path, value, origin };
  const inverse: SlideTreePatch = { op: 'remove', path, value, origin };
  return { forward: [forward], inverse: [inverse] };
}
