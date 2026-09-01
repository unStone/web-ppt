import { queryTextParagraphProps, textBodyFromOverride } from './text-model';
import type { TextRange } from './commands/types';
import type { EditDoc, ParagraphPropertiesState, TableCellAddress } from './types';
import { textTargetContext } from './commands/text-target';
import { hydrateInsertionResourceSource } from './session-assets';

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
  const state = queryTextParagraphProps(
    body, range, override?.kind === 'flat' ? override : undefined,
  );
  const bullet = state.bullet.value;
  const src = bullet?.kind === 'blip' ? bullet.image.src : undefined;
  const hash = src?.startsWith('web-ppt-resource:') ? src.slice('web-ppt-resource:'.length) : null;
  const resource = hash ? doc.imageResources[hash] : undefined;
  return resource && bullet?.kind === 'blip' ? {
    ...state,
    bullet: {
      ...state.bullet,
      value: {
        ...bullet,
        image: { src: hydrateInsertionResourceSource(bullet.image.src, resource) },
      },
    },
  } : state;
}
