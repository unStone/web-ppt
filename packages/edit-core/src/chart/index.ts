import type { EditDoc, ElementId } from '../types';
import { chartRecordIds, readChartDataset } from './source';
import type { ChartDataset, EditableChart } from './types';
export { chartDataEditor as createChartDataEditor } from './commands';
export { chartProjection } from './projection';
export type { ChartDataEditor } from './commands';

export type {
  ChartCategory, ChartDataBinding, ChartDataset, ChartFormulaBinding, ChartPlotKind,
  ChartPoint, ChartPointId, ChartSeries, ChartSeriesId, EditableChart,
} from './types';

export function listEditableCharts(doc: EditDoc): EditableChart[] {
  return chartRecordIds(doc).map((id) => {
    const data = readChartDataset(doc, id);
    return { id, name: doc.elements[id].src.name ?? '图表', binding: data.binding };
  });
}

export function queryChartData(doc: EditDoc, id: ElementId): ChartDataset {
  return readChartDataset(doc, id);
}
