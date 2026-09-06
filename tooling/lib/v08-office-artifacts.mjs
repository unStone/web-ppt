/** 0.8 跨能力门禁的 LibreOffice 与 PowerPoint 只消费这一份清单；后续票继续向这里追加。 */
import { mediaArtifacts } from './media-artifacts.mjs';

export const V08_EXTRA_SOURCES = Object.freeze([
  ...['patched', 'generated'].flatMap((mode) => [
    { file: `comments-${mode}.pptx`, slides: 4, source: `out/edit-save/comments-${mode}.pptx` },
    { file: `appearance-${mode}.pptx`, slides: 1, source: `out/edit-save/appearance-${mode}.pptx` },
    { file: `mixed-${mode}.pptx`, slides: 10, source: `out/edit-save/mixed-${mode}.pptx` },
  ]),
  ...['patch', 'generated'].map((mode) => ({ file: `chartex-native-${mode}.pptx`, slides: 8, source: `out/chartex-native/native-${mode}.pptx` })),
  ...mediaArtifacts.map(({ name, pages }) => ({ file: `media-${name}.pptx`, slides: pages, source: `out/media-insertion/${name}.pptx` })),
]);
export const V08_OFFICE_ARTIFACTS = Object.freeze([
  Object.freeze({
    file: 'chart-data-edited.pptx', slides: 10,
    chartData: Object.freeze({
      slide: 1, series: 1, point: 1, workbookCell: 'B2', value: 4096,
      seriesName: '保存后营收', category: '保存后一季度',
    }),
    required: Object.freeze(['保存后营收', '保存后一季度', '4096', '3400']),
  }),
  Object.freeze({
    file: 'chart-data-empty-rebuilt.pptx', slides: 10,
    chartData: Object.freeze({
      slide: 1, series: 1, point: 1, workbookCell: 'C2', value: 5151,
      seriesName: '重开重建系列', category: '第一季度',
    }),
    required: Object.freeze(['重开重建系列', '第一季度', '5151']),
  }),
  ...V08_EXTRA_SOURCES.map(({ file, slides }) => Object.freeze({ file, slides })),
]);

export const V08_OFFICE_MANIFEST = 'office-artifacts.json';
