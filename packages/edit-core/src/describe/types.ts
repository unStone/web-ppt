export interface DescriptionReference {
  readonly id: string;
  readonly name: string;
}

export interface DescriptionPlaceholder {
  readonly type: string;
  readonly index: string | null;
  readonly layout: { readonly id: string; readonly elementId: string } | null;
  readonly master: { readonly id: string; readonly elementId: string } | null;
}

export interface DescriptionParagraph {
  readonly text: string;
  readonly level: number;
  readonly bullet: {
    readonly kind: 'none' | 'text' | 'image';
    readonly text: string | null;
    readonly numbering: { readonly type: string; readonly startAt: number } | null;
  };
  readonly cell: { readonly row: number; readonly column: number } | null;
}

export interface DescriptionElement {
  readonly id: string;
  readonly kind: 'shape' | 'image' | 'group' | 'table' | 'unsupported';
  readonly name: string;
  readonly altText: { readonly title: string; readonly description: string };
  /** 根到自身的稳定 ID；先序截断后仍能解析每个已返回元素的祖先。 */
  readonly path: readonly string[];
  readonly canvas: { readonly kind: 'slide' | 'layout' | 'master'; readonly id: string };
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly editable: 'full' | 'frame' | 'none';
  readonly hidden: boolean;
  readonly locked: boolean;
  readonly placeholder: DescriptionPlaceholder | null;
  readonly paragraphs: readonly DescriptionParagraph[];
}

export interface DescriptionSlide {
  readonly id: string;
  /** 面向使用者的页码，从 1 开始，包含隐藏页。 */
  readonly number: number;
  readonly hidden: boolean;
  readonly layout: DescriptionReference | null;
  readonly master: DescriptionReference | null;
  readonly section: DescriptionReference | null;
  readonly notes: string;
  readonly elements: readonly DescriptionElement[];
}

export interface PresentationDescription {
  readonly version: 1;
  readonly source: 'pptx' | 'ppt';
  readonly width: number;
  readonly height: number;
  readonly totalSlides: number;
  /** 按页面计数，同一个设计对象在不同页面出现时分别计入。 */
  readonly totalElements: number;
  readonly slides: readonly DescriptionSlide[];
  readonly truncation: {
    readonly reason: 'max-chars' | 'max-tokens' | null;
    readonly omittedSlides: number;
    readonly omittedElements: number;
    /** elementId 为 null 时，截断发生在整页元数据之前。 */
    readonly next: { readonly slideNumber: number; readonly elementId: string | null } | null;
  };
}

export interface DescribeOptions {
  /** JSON.stringify(result) 的 UTF-16 单元数上限，包含截断说明。 */
  readonly maxChars?: number;
  readonly maxTokens?: number;
  /** 使用目标模型的计数规则；设置 maxTokens 时必须提供，返回非负安全整数。 */
  readonly countTokens?: (json: string) => number;
}

export type DescribeFailureReason =
  | 'invalid-budget' | 'token-counter-required' | 'invalid-token-count' | 'token-count-failed' | 'budget-too-small'
  | 'invalid-document' | 'unaddressable-element' | 'invalid-geometry';

export class DescribeError extends Error {
  constructor(
    readonly reason: DescribeFailureReason,
    message: string,
    readonly slideNumber: number | null = null,
    readonly elementId: string | null = null,
  ) {
    super(message);
    this.name = 'DescribeError';
  }
}
