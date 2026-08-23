import type { Paragraph, TextBody, TextVert } from '../types';
import type { TextMeasure } from './text-measure';

export interface TextLayoutOptions {
  /** 覆盖 TextBody.insets；表格单元格使用自己的边距。 */
  insets?: readonly [number, number, number, number];
  /** 覆盖垂直对齐；表格单元格使用自己的对齐。 */
  anchor?: TextBody['anchor'];
  /** 覆盖文字方向；返回的 transform 把逻辑行盒映射到元素局部坐标。 */
  vert?: TextVert;
  /** 显式有效字号比例；省略时使用 fontScale，并解析裸 normAutofit。 */
  scale?: number;
  /** 注入后布局不访问 Canvas，适合 Worker、测试或宿主自己的字体测量服务。 */
  measureText?: TextMeasure;
  /** 关闭逐字停靠点可减少只需行盒时的测量与分配；默认开启。 */
  includeCarets?: boolean;
}

export interface TextLayoutCaret {
  /** TextRun.text 内的 UTF-16 偏移，与 DOM Range.offset 同口径。 */
  offset: number;
  /** 逻辑排版坐标中的光标 x；RTL 行按阅读方向递减。 */
  x: number;
}

export interface TextLayoutSegment {
  /** -1 表示由段落属性生成的项目符号，不属于任何正文 run。 */
  runIndex: number;
  /** TextRun.text 内 UTF-16 半开区间；项目符号固定为 0..0。 */
  from: number;
  to: number;
  /** 实际绘制文本，已应用 all-caps；公式保留源文本。 */
  text: string;
  x: number;
  /** CJK 挤压后的逻辑占位宽度。 */
  width: number;
  /** 挤压前宽度。 */
  naturalWidth: number;
  bullet: boolean;
  /** 公式是不可拆原子，只允许 carets 的首尾两个停靠点。 */
  atomic: boolean;
  carets: TextLayoutCaret[];
}

export interface TextLayoutLine {
  paragraphIndex: number;
  lineIndex: number;
  columnIndex: number;
  x: number;
  y: number;
  width: number;
  naturalWidth: number;
  height: number;
  baseline: number;
  /** 原生 SVG `<text>` 使用的锚点坐标。 */
  anchorX: number;
  align: Paragraph['align'];
  rtl: boolean;
  squeezed: boolean;
  segments: TextLayoutSegment[];
}

export interface TextLayout {
  width: number;
  height: number;
  /** 应用 transform 之前的排版空间；竖排时与元素宽高互换。 */
  layoutWidth: number;
  layoutHeight: number;
  scale: number;
  autoFit: 'none' | 'normal' | 'shape';
  columns: number;
  vert: TextVert;
  /** 逻辑排版坐标 → 元素局部坐标的 SVG/CSS 仿射矩阵 [a,b,c,d,e,f]。 */
  transform: readonly [number, number, number, number, number, number];
  /** 艺术字编辑时行盒是未变形形态，静态预览仍走 textPath。 */
  unwarped: boolean;
  lines: TextLayoutLine[];
}
