export interface TemplateFillParagraph {
  readonly text: string;
  readonly level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  readonly bullet?: boolean;
}

export interface TemplateFillImage {
  readonly bytes: string;
  readonly mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  readonly altText?: string;
  readonly fit?: 'contain' | 'cover';
}

export interface TemplateFillChartSeries {
  readonly name: string;
  readonly values: readonly (number | null)[];
  readonly x?: readonly (number | null)[];
  readonly sizes?: readonly (number | null)[];
}

export interface TemplateFillChart {
  readonly type: 'bar' | 'line' | 'pie' | 'doughnut' | 'area' | 'scatter' | 'radar' | 'bubble';
  readonly categories: readonly string[];
  readonly series: readonly TemplateFillChartSeries[];
  readonly title?: string;
}

export interface TemplateFillSlideBase {
  readonly title: string;
  readonly notes?: string;
  readonly layoutId?: string;
}

export interface TemplateFillTitleSlide extends TemplateFillSlideBase {
  readonly type: 'title';
  readonly subtitle?: string;
}

export interface TemplateFillSectionSlide extends TemplateFillSlideBase {
  readonly type: 'section';
  readonly body?: readonly TemplateFillParagraph[];
}

export interface TemplateFillContentSlide extends TemplateFillSlideBase {
  readonly type: 'content';
  /** @minItems 1 */
  readonly body: readonly TemplateFillParagraph[];
}

export interface TemplateFillTwoColumnSlide extends TemplateFillSlideBase {
  readonly type: 'two-column';
  readonly columns: readonly [readonly TemplateFillParagraph[], readonly TemplateFillParagraph[]];
}

export interface TemplateFillImageSlide extends TemplateFillSlideBase {
  readonly type: 'image';
  readonly image: TemplateFillImage;
  readonly body?: readonly TemplateFillParagraph[];
}

export interface TemplateFillChartSlide extends TemplateFillSlideBase {
  readonly type: 'chart';
  readonly chart: TemplateFillChart;
}

export type TemplateFillSlide =
  | TemplateFillTitleSlide
  | TemplateFillSectionSlide
  | TemplateFillContentSlide
  | TemplateFillTwoColumnSlide
  | TemplateFillImageSlide
  | TemplateFillChartSlide;

export interface TemplateFillOutline {
  readonly version: 1;
  /** @minItems 1 */
  readonly slides: readonly TemplateFillSlide[];
}
