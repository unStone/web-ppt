import type { EditDoc } from '../types';
import type { EditExtensionSavePlan } from '../extension-runtime';
import { materializeChartTree } from './materialize';
import { serializeXmlTreeBytes } from '@web-ppt/edit-core/xml';
import { chartStateHasEffectiveChanges, currentChartDatasetState, hydrateChartDataset } from './source';
import { patchChartWorkbook } from './workbook';
import type { ChartDatasetState } from './types';
import { chartPartForElement } from './locator';

const NS = 'chart-data';

function baseline(doc: EditDoc, part: string): Uint8Array | null {
  return doc.saveState.baselines[part] ?? doc.package?.parts[part] ?? null;
}

function storedState(doc: EditDoc, id: string): ChartDatasetState | null {
  return doc.elements[id]?.ovr.extensions?.[NS] as ChartDatasetState | undefined ?? null;
}

/** 图表和工作簿先形成一个 OPC 原子提交，普通保存随后只处理其余 part。 */
export function saveChartDatasets(doc: EditDoc): EditExtensionSavePlan | void {
  if (!doc.package || doc.package.disposed || doc.meta.source !== 'pptx') return;
  const changes: Record<string, Uint8Array> = Object.create(null);
  const baselines: Record<string, Uint8Array> = Object.create(null);
  for (const record of Object.values(doc.elements)) {
    const part = chartPartForElement(doc, record.id);
    if (!part) continue;
    const state = storedState(doc, record.id);
    const tracked = doc.saveState.baselines[part] !== undefined;
    if (!state && !tracked) continue;
    const chartBaseline = baseline(doc, part);
    if (!chartBaseline) throw new Error(`图表来源 part 不存在：${part}`);
    baselines[part] = doc.saveState.baselines[part] ?? chartBaseline.slice();
    const sourceState = hydrateChartDataset(doc, record.id);
    const workbookPart = sourceState.binding.workbookPart;
    if (!state || !chartStateHasEffectiveChanges(doc, record.id)) {
      if (!tracked) continue;
      changes[part] = baselines[part];
      if (workbookPart && doc.saveState.baselines[workbookPart]) {
        baselines[workbookPart] = doc.saveState.baselines[workbookPart];
        changes[workbookPart] = baselines[workbookPart];
      }
      continue;
    }
    let materializedState = currentChartDatasetState(doc, record.id);
    if (materializedState.binding.mode === 'workbook') {
      if (!workbookPart) throw new Error('工作簿同步状态缺少目标 part');
      const workbookBaseline = baseline(doc, workbookPart);
      if (!workbookBaseline) throw new Error(`内嵌工作簿不存在：${workbookPart}`);
      baselines[workbookPart] = doc.saveState.baselines[workbookPart] ?? workbookBaseline.slice();
      const workbook = patchChartWorkbook(workbookBaseline, materializedState);
      materializedState = workbook.state;
      changes[workbookPart] = workbook.bytes;
    } else if (materializedState.binding.mode === 'readonly') {
      throw new Error(materializedState.binding.reason ?? '图表数据只读');
    }
    changes[part] = serializeXmlTreeBytes(
      materializeChartTree(chartBaseline, record.id, materializedState),
    );
  }
  if (!Reflect.ownKeys(changes).length) return;
  return { changes, baselines };
}
