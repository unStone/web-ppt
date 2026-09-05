import type { EditDoc, Editor, ElementId } from '@web-ppt/edit-core';
import {
  createChartDataEditor, listEditableCharts, queryChartData,
  type ChartDataEditor, type ChartDataset, type ChartPointId, type ChartSeriesId,
} from '@web-ppt/edit-core/chart';
import * as editorChart from '@web-ppt/editor/chart';
import * as reactChart from '@web-ppt/react/chart';
import * as vueChart from '@web-ppt/vue/chart';

declare const doc: EditDoc;
declare const editor: Editor;
declare const chartId: ElementId;
declare const seriesId: ChartSeriesId;
declare const pointId: ChartPointId;

const charts = listEditableCharts(doc);
const dataset: ChartDataset = queryChartData(doc, chartId);
const dataEditor: ChartDataEditor = createChartDataEditor(editor);
dataEditor.setPoint(chartId, seriesId, pointId, { x: 1, value: null, size: 2 });

const sameEntry: typeof createChartDataEditor = editorChart.createChartDataEditor;
const reactEntry: typeof createChartDataEditor = reactChart.createChartDataEditor;
const vueEntry: typeof createChartDataEditor = vueChart.createChartDataEditor;

void [charts, dataset, sameEntry, reactEntry, vueEntry];
