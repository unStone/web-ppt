import { own } from './data-validation';
import { toSlide } from './projection';
import type {
  EditDoc, SlideBackgroundState, SlideHiddenState, SlideId, SlideLayoutState,
} from './types';

function records(doc: EditDoc, ids: readonly SlideId[]) {
  if (!ids.length) throw new Error('页面属性查询至少需要一个页面');
  return ids.map((id) => {
    const record = doc.slides[id];
    if (!record) throw new Error(`找不到幻灯片：${id}`);
    return record;
  });
}

export function querySlideBackground(
  doc: EditDoc,
  ids: readonly SlideId[],
): SlideBackgroundState {
  const selected = records(doc, ids);
  const values = ids.map((id) => toSlide(doc, id).background);
  const sources = selected.map((record) => record.src.background);
  const valueSignature = JSON.stringify(values[0]);
  const sourceSignature = JSON.stringify(sources[0]);
  return {
    value: structuredClone(values[0] ?? null),
    source: structuredClone(sources[0] ?? null),
    mixed: values.some((value) => JSON.stringify(value) !== valueSignature),
    sourceMixed: sources.some((value) => JSON.stringify(value) !== sourceSignature),
    direct: selected.some((record) => own(record.ovr, 'background')),
  };
}

export function querySlideHidden(doc: EditDoc, ids: readonly SlideId[]): SlideHiddenState {
  const selected = records(doc, ids);
  const values = ids.map((id) => !!toSlide(doc, id).hidden);
  const sources = selected.map((record) => !!record.src.hidden);
  return {
    value: values[0],
    source: sources[0],
    mixed: values.some((value) => value !== values[0]),
    sourceMixed: sources.some((value) => value !== sources[0]),
    direct: selected.some((record) => own(record.ovr, 'hidden')),
  };
}

export function querySlideLayout(doc: EditDoc, ids: readonly SlideId[]): SlideLayoutState {
  const selected = records(doc, ids);
  const values = selected.map((record) => record.layoutId ?? null);
  const sources = selected.map((record) => record.sourceLayoutId ?? null);
  return {
    value: values[0],
    source: sources[0],
    mixed: values.some((value) => value !== values[0]),
    sourceMixed: sources.some((value) => value !== sources[0]),
    direct: selected.some((record) => (record.layoutId ?? null) !== (record.sourceLayoutId ?? null)),
  };
}
