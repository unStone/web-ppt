import type { ElementRecord } from '../types';

/** 九级文字样式是解析期只读目录；单记录快照复用它，批量历史再统一深拷贝。 */
export function cloneElementRecord(record: ElementRecord): ElementRecord {
  const levelTemplate = record.src.editInfo?.textLevelTemplate;
  if (!levelTemplate) return structuredClone(record);
  const { textLevelTemplate: _shared, ...editInfo } = record.src.editInfo!;
  const clone = structuredClone({
    ...record,
    src: { ...record.src, editInfo },
  }) as ElementRecord;
  clone.src.editInfo = { ...clone.src.editInfo!, textLevelTemplate: levelTemplate };
  return clone;
}
