import { queryTextRunProps, textBodyFromOverride } from './text-model';
import type { TextRange } from './commands/types';
import type { EditDoc, RunPropertiesState } from './types';

/** 面板与框架适配层只从 headless 文档查询，不把格式真相藏进 DOM。 */
export function queryRunProps(doc: EditDoc, id: string, range: TextRange): RunPropertiesState {
  const record = doc.elements[id];
  if (!record || record.src.kind !== 'shape' || (!record.src.text && !record.meta.textTemplate)) {
    throw new Error(`找不到可查询文字格式的形状：${id}`);
  }
  const override = record.ovr.text;
  const body = override?.kind === 'flat'
    ? textBodyFromOverride(override)
    : (record.src.text ?? record.meta.textTemplate!);
  return queryTextRunProps(body, range, override?.kind === 'flat' ? override : undefined);
}
