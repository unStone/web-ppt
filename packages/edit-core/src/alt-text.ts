import { own } from './data-validation';
import type { EditDoc, ElementAltTextState, ElementId } from './types';

export const MAX_ALT_TEXT_LENGTH = 32_767;

export function assertAltTextField(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string') throw new Error(`${label} 必须是字符串`);
  if (value.length > MAX_ALT_TEXT_LENGTH) {
    throw new Error(`${label} 不能超过 ${MAX_ALT_TEXT_LENGTH} 个 UTF-16 单元`);
  }
  if (/[\0-\x1f\x7f]/.test(value)) throw new Error(`${label} 不能包含控制字符`);
}

/** 替代文字与对象名称是两套 cNvPr 属性；查询不能用名称兜底。 */
export function queryElementAltText(doc: EditDoc, id: ElementId): ElementAltTextState {
  const record = doc.elements[id];
  if (!record) throw new Error(`找不到元素：${id}`);
  const sourceTitle = record.src.editInfo?.altText?.title ?? '';
  const sourceDescr = record.src.editInfo?.altText?.descr ?? '';
  const directTitle = own(record.ovr.altText ?? {}, 'title');
  const directDescr = own(record.ovr.altText ?? {}, 'descr');
  return {
    title: directTitle ? record.ovr.altText!.title! : sourceTitle,
    descr: directDescr ? record.ovr.altText!.descr! : sourceDescr,
    sourceTitle,
    sourceDescr,
    directTitle,
    directDescr,
    direct: directTitle || directDescr,
  };
}
