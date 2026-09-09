import type { EditDoc, ElementId } from '../types';
import type { ChartDatasetState } from './types';
import { chartSourceBytes, chartRelationshipPart } from './context';
import { chartFrameKey, chartPartForElement } from './locator';

interface SourceEntry {
  readonly relationships?: Uint8Array;
  readonly workbook?: Uint8Array;
  readonly state: ChartDatasetState;
}
const sources = new WeakMap<Uint8Array, Map<string, SourceEntry>>();

/** 缓存只依赖不可变来源字节，编辑覆盖仍每次重新投影；保存后的原始基线也必须参与失效判断。 */
export function cachedSharedSource(doc: EditDoc, id: ElementId, deferred: boolean, nativePart: string | undefined,
  read: () => ChartDatasetState): ChartDatasetState {
  const part = nativePart ?? chartPartForElement(doc, id), bytes = part && chartSourceBytes(doc, part);
  if (!part || !bytes) return read();
  let entries = sources.get(bytes);
  if (!entries) { entries = new Map(); sources.set(bytes, entries); }
  const key = JSON.stringify([part, id, nativePart ? '' : chartFrameKey(doc, id), deferred]);
  const relationships = chartSourceBytes(doc, chartRelationshipPart(part)), cached = entries.get(key);
  const workbook = cached?.state.binding.workbookPart;
  if (cached && cached.relationships === relationships
    && cached.workbook === (workbook ? chartSourceBytes(doc, workbook) : undefined)) {
    return structuredClone(cached.state);
  }
  const state = read();
  entries.set(key, { state, relationships,
    workbook: state.binding.workbookPart ? chartSourceBytes(doc, state.binding.workbookPart) : undefined });
  return structuredClone(state);
}
