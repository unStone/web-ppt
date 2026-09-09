import type { ElementId, FractionalIndex } from '../types';

export type ChartSeriesId = string & { readonly __chartSeriesId: unique symbol };
export type ChartPointId = string & { readonly __chartPointId: unique symbol };
export type ChartPlotKind =
  | 'bar' | 'line' | 'pie' | 'doughnut' | 'area' | 'scatter' | 'radar'
  | 'bubble' | 'stock' | 'ofPie' | 'surface' | 'other';

export interface ChartFormulaBinding {
  readonly formula: string | null;
  readonly cache: 'number' | 'string' | 'literal' | 'missing';
  readonly hierarchy?: { readonly levels: number; readonly orientation: 'rows' | 'columns' };
}

export interface ChartDataBinding {
  readonly chartPart: string;
  readonly workbookPart: string | null;
  readonly mode: 'workbook' | 'cache' | 'readonly';
  readonly reason?: string;
  /** 旧编辑或共享覆盖无法解释时，不返回可被误认为当前数据的来源缓存。 */
  readonly unresolved?: true;
}

export interface ChartCategory {
  readonly id: ChartPointId;
  readonly order: FractionalIndex;
  readonly label: string;
  /** 从根到叶的原生槽位；父级 null 延续组，叶级 null 是缺失标签，空字符串是显式空值。 */
  readonly levels?: readonly (string | null)[];
  readonly removed?: true;
}

export interface ChartPoint {
  readonly id: ChartPointId;
  readonly order: FractionalIndex;
  readonly value: number | null;
  readonly x?: number | null;
  readonly size?: number | null;
  readonly removed?: true;
}

export interface ChartSeries {
  readonly id: ChartSeriesId;
  readonly order: FractionalIndex;
  readonly sourceIndex: number;
  readonly plotKind: ChartPlotKind;
  readonly name: string;
  readonly points: readonly ChartPoint[];
  readonly bindings: {
    readonly name: ChartFormulaBinding;
    readonly categories?: ChartFormulaBinding;
    readonly values?: ChartFormulaBinding;
    readonly x?: ChartFormulaBinding;
    readonly y?: ChartFormulaBinding;
    readonly size?: ChartFormulaBinding;
  };
  readonly removed?: true;
}

export interface ChartDataset {
  readonly chartId: ElementId;
  readonly kind: 'category' | 'xy' | 'mixed';
  /** 来源绘图区能安全复用的系列类型；删空后仍可据此重建。 */
  readonly plotKinds: readonly ChartPlotKind[];
  readonly categories: readonly ChartCategory[];
  readonly series: readonly ChartSeries[];
  readonly binding: ChartDataBinding;
}

export interface EditableChart {
  readonly id: ElementId;
  readonly name: string;
  readonly binding: ChartDataBinding;
}

export interface ChartDatasetState {
  kind: ChartDataset['kind'];
  binding: ChartDataBinding;
  categories: Record<ChartPointId, ChartCategory & {
    /** 新增类别创建时的前驱；墓碑保留分组，但不能让后来新增的类别复活已删除的组。 */
    levelParent?: ChartPointId | null;
    /** 清空组首时接受的前驱；后续删除前驱也不能改变已经选择的分组。 */
    levelClears?: Readonly<Record<string, ChartPointId | null>>;
  }>;
  series: Record<ChartSeriesId, Omit<ChartSeries, 'points'> & {
    points: Record<ChartPointId, ChartPoint>;
    /** 仅表示 wppt 持久模板；其公式必须先按未受信来源通过工作簿占用检查。 */
    sourceTemplate?: true;
  }>;
}
