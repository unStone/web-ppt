import { own } from './data-validation';
import { toSlide } from './projection';
import type { EditDoc, SlideId, SlideNotesState } from './types';

export function querySlideNotes(doc: EditDoc, ids: readonly SlideId[]): SlideNotesState {
  if (!ids.length) throw new Error('备注查询至少需要一个页面');
  const records = ids.map((id) => {
    const record = doc.slides[id];
    if (!record) throw new Error(`找不到幻灯片：${id}`);
    return record;
  });
  const values = ids.map((id) => toSlide(doc, id).notes ?? '');
  const sources = records.map((record) => record.src.notes ?? '');
  return {
    value: values[0],
    source: sources[0],
    mixed: values.some((value) => value !== values[0]),
    sourceMixed: sources.some((value) => value !== sources[0]),
    direct: records.some((record) => own(record.ovr, 'notes')),
  };
}
