import { insertionPackageTargets } from '../source-retention';
import { sessionAsset } from '../session-assets';
import type { EditDoc, ElementInsertionResource } from '../types';

/** 生成保存没有可覆盖的 OPC 目标；只在校验视图中把自带字节的媒体转成新资源。 */
export function generatedValidationDoc(doc: EditDoc): EditDoc {
  if (!doc.package?.disposed) return doc;
  const baselines = { ...doc.saveState.baselines };
  const retain = (part: string | undefined): void => {
    if (!part || baselines[part]) return;
    const bytes = sessionAsset(doc, `web-ppt-source:${part}`)?.bytes;
    if (bytes) baselines[part] = bytes;
  };
  const resource = (value: ElementInsertionResource): ElementInsertionResource => ({ ...value, created: true });
  const elements = Object.fromEntries(Object.entries(doc.elements).map(([id, record]) => {
    const insertion = record.meta.insertion;
    if (!insertion) return [id, record];
    for (const target of insertionPackageTargets(record)) retain(target);
    return [id, { ...record, meta: { ...record.meta, insertion: {
      ...insertion, resources: insertion.resources?.map(resource),
    } } }];
  }));
  for (const slide of Object.values(doc.slides)) {
    retain(slide.creation?.duplicateSourcePart);
    retain(slide.creation?.duplicateNotesSourcePart);
  }
  return {
    ...doc, elements, meta: { ...doc.meta, readonly: true }, package: null,
    imageResources: Object.fromEntries(Object.entries(doc.imageResources).map(([key, value]) => [key, resource(value)])),
    saveState: { ...doc.saveState, baselines },
  };
}
