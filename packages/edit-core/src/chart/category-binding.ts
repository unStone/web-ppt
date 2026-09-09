import type { ChartSeries, ChartFormulaBinding } from './types';

export type CategoryOrientation = NonNullable<ChartFormulaBinding['hierarchy']>['orientation'];

/** 墓碑系列仍保存类别矩阵的定义，删空系列后才能继续编辑和重建。 */
export const categoryHierarchyBinding = (series: Readonly<Record<string, Pick<ChartSeries, 'bindings'>>>) =>
  Object.values(series).find(item => item.bindings.categories?.hierarchy)?.bindings.categories;
