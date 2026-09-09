import { chartSourceBytes } from './context';
import type { EditDoc } from '../types';
import type { EditExtensionSavePlan } from '../extension-runtime';
import { materializeChartTree } from './materialize';
import { serializeXmlTreeBytes } from '@web-ppt/edit-core/xml';
import { chartStateHasEffectiveChanges, currentChartDatasetState, hydrateChartDataset } from './source';
import { patchChartWorkbook } from './workbook';
import type { ChartDatasetState } from './types';
import { chartPartForElement, chartFrameKey } from './locator';
import { sharedChartRuntime } from './shared-runtime';

const NS = 'chart-data';

function storedState(doc: EditDoc, id: string): ChartDatasetState | null {
  return doc.elements[id]?.ovr.extensions?.[NS] as ChartDatasetState | undefined ?? null;
}

/** 图表和工作簿先形成一个 OPC 原子提交，普通保存随后只处理其余 part。 */
export function saveChartDatasets(doc: EditDoc): EditExtensionSavePlan | void {
  if (doc.meta.source !== 'pptx') return;
  const changes: Record<string, Uint8Array> = Object.create(null);
  const baselines: Record<string, Uint8Array> = Object.create(null);
  const visited = new Set<string>();
  for (const record of Object.values(doc.elements)) {
    const part = chartPartForElement(doc, record.id);
    if (!part || visited.has(part)) continue;
    const state = storedState(doc, record.id);
    const tracked = doc.saveState.baselines[part] !== undefined;
    if (!state && !tracked && !sharedChartRuntime()?.active(doc)) continue;
    // 未触碰的框架不能占用整个部件的保存名额；后面的副本仍可能持有旧局部编辑。
    visited.add(part);
    const chartBaseline = chartSourceBytes(doc, part);
    if (!chartBaseline) throw new Error(`图表来源 part 不存在：${part}`);
    baselines[part] = doc.saveState.baselines[part] ?? chartBaseline.slice();
    const sourceState = hydrateChartDataset(doc, record.id);
    const workbookPart = sourceState.binding.workbookPart;
    if (!chartStateHasEffectiveChanges(doc, record.id)) {
      if (!tracked) continue;
      changes[part] = baselines[part];
      if (workbookPart && doc.saveState.baselines[workbookPart] && !sharedChartRuntime()?.workbook?.(doc, record.id)) {
        baselines[workbookPart] = doc.saveState.baselines[workbookPart];
        changes[workbookPart] ??= baselines[workbookPart];
      }
      continue;
    }
    let materializedState = currentChartDatasetState(doc, record.id);
    if (materializedState.binding.mode === 'workbook') {
      if (!workbookPart) throw new Error('工作簿同步状态缺少目标 part');
      const workbookBaseline = chartSourceBytes(doc, workbookPart);
      if (!workbookBaseline) throw new Error(`内嵌工作簿不存在：${workbookPart}`);
      baselines[workbookPart] = doc.saveState.baselines[workbookPart] ?? workbookBaseline.slice();
      if (sharedChartRuntime()?.workbook?.(doc, record.id)) {
        if (state && !sharedChartRuntime()?.active(doc, workbookPart)) throw new Error('共享关系中的既有局部覆盖尚未迁移为文档事务');
      } else {
        const workbook = patchChartWorkbook(changes[workbookPart] ?? workbookBaseline, materializedState);
        materializedState = workbook.state;
        changes[workbookPart] = workbook.bytes;
      }
    } else if (materializedState.binding.mode === 'readonly') {
      throw new Error(materializedState.binding.reason ?? '图表数据只读');
    }
    changes[part] = serializeXmlTreeBytes(
      materializeChartTree(chartBaseline, record.id, materializedState, chartFrameKey(doc, record.id),
        sharedChartRuntime()?.identityScopes?.(doc, part, chartBaseline, record.id)),
    );
  }
  if (!Reflect.ownKeys(changes).length) return;
  return { changes, baselines };
}
