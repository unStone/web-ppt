import { queryTextParagraphProps, textBodyFromOverride } from './text-model';
import type { TextRange } from './commands/types';
import type { EditDoc, ParagraphPropertiesState } from './types';

/** 工具栏只查询 headless 文档；DOM 选区只是把范围传进来。 */
export function queryParaProps(doc: EditDoc, id: string, range: TextRange): ParagraphPropertiesState {
  const record = doc.elements[id];
  if (!record || record.src.kind !== 'shape' || (!record.src.text && !record.meta.textTemplate)) {
    throw new Error(`找不到可查询段落格式的形状：${id}`);
  }
  const override = record.ovr.text;
  const body = override?.kind === 'flat'
    ? textBodyFromOverride(override)
    : (record.src.text ?? record.meta.textTemplate!);
  return queryTextParagraphProps(body, range, override?.kind === 'flat' ? override : undefined);
}
