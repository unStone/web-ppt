import { queryTextParagraphProps, textBodyFromOverride } from './text-model';
import type { TextRange } from './commands/types';
import type { EditDoc, ParagraphPropertiesState, TableCellAddress } from './types';
import { textTargetContext } from './commands/text-target';

/** 工具栏只查询 headless 文档；DOM 选区只是把范围传进来。 */
export function queryParaProps(
  doc: EditDoc,
  id: string,
  range: TextRange,
  cell?: TableCellAddress,
): ParagraphPropertiesState {
  const { body: source, before: override } = textTargetContext(
    doc, { id, ...(cell !== undefined ? { cell } : {}) },
  );
  const body = override?.kind === 'flat'
    ? textBodyFromOverride(override)
    : source;
  return queryTextParagraphProps(body, range, override?.kind === 'flat' ? override : undefined);
}
