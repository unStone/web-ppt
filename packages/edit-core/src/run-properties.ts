import { queryTextRunProps, textBodyFromOverride } from './text-model';
import type { TextRange } from './commands/types';
import type { EditDoc, RunPropertiesState, TableCellAddress } from './types';
import { textTargetContext } from './commands/text-target';

/** 面板与框架适配层只从 headless 文档查询，不把格式真相藏进 DOM。 */
export function queryRunProps(
  doc: EditDoc,
  id: string,
  range: TextRange,
  cell?: TableCellAddress,
): RunPropertiesState {
  const { body: source, before: override } = textTargetContext(
    doc, { id, ...(cell !== undefined ? { cell } : {}) },
  );
  const body = override?.kind === 'flat'
    ? textBodyFromOverride(override)
    : source;
  return queryTextRunProps(body, range, override?.kind === 'flat' ? override : undefined);
}
