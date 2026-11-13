export const CHART_TYPES = ['bar', 'line', 'area', 'pie', 'doughnut', 'radar', 'scatter', 'bubble'] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const TRENDLINE_TYPES = ['linear', 'exponential', 'logarithmic', 'movingAvg', 'poly', 'power'] as const;
export type TrendlineType = (typeof TRENDLINE_TYPES)[number];

/** 单条趋势线。series 缺省作用于第 0 个系列；数组整值替换（undefined = 不动原文件）。 */
export interface ChartTrendline {
  /** 目标系列（绘图区内 c:ser 全局顺序，与 palette 同口径） */
  series?: number;
  type: TrendlineType;
  /** poly 阶数（2–6，缺省 2） */
  order?: number;
  /** movingAvg 周期（≥2，缺省 2） */
  period?: number;
  /** 前推 / 后推（类目图按类目数，散点按 x 单位） */
  forward?: number;
  backward?: number;
  /** 固定截距（linear / exponential） */
  intercept?: number;
  /** 显示公式与 R²（movingAvg 不提供，写入侧忽略） */
  equation?: boolean;
  rSquare?: boolean;
  /** 图例名；缺省由渲染层自动生成 */
  name?: string;
  /** 线色；缺省沿用系列色 */
  color?: string;
}

export const ERROR_VALUE_TYPES = ['fixedVal', 'percentage', 'stdDev', 'stdErr', 'cust'] as const;
export type ErrorValueType = (typeof ERROR_VALUE_TYPES)[number];

/** 一组误差线。direction 'both' 会写出 x / y 两条 c:errBars（仅散点 / 气泡有意义）。 */
export interface ChartErrorBars {
  series?: number;
  direction?: 'x' | 'y' | 'both';
  /** c:errBarType：both / plus / minus，缺省 both */
  amount?: 'both' | 'plus' | 'minus';
  valueType: ErrorValueType;
  /** fixedVal / percentage / stdDev 的量（stdDev 是标准差倍数） */
  value?: number;
  /** cust 的上下偏移（按点下标，null = 0） */
  plus?: readonly (number | null)[];
  minus?: readonly (number | null)[];
  noEndCap?: boolean;
  color?: string;
}

/** 数据表。缺省布尔均为 OOXML 缺省 true。 */
export interface ChartDataTable {
  horizontalBorders?: boolean;
  verticalBorders?: boolean;
  outline?: boolean;
  keys?: boolean;
}

export interface ChartDesign {
  type?: ChartType;
  horizontal?: boolean;
  grouping?: 'standard' | 'stacked' | 'percentStacked';
  palette?: readonly string[];
  legend?: 'none' | 'left' | 'right' | 'top' | 'bottom';
  labels?: boolean;
  title?: string;
  /** 趋势线；undefined = 保持原样，[] = 全部移除 */
  trendlines?: readonly ChartTrendline[];
  /** 误差线；undefined = 保持原样，[] = 全部移除 */
  errorBars?: readonly ChartErrorBars[];
  /** 数据表；undefined = 保持原样，null = 移除 */
  dataTable?: ChartDataTable | null;
}
