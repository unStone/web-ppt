import type { TextMeasure } from '@web-ppt/core';
import type { PresentationDescription } from '../describe/types';
import type { LayoutLintOptions, LayoutLintReport } from '../lint/types';

export interface TemplateFillOptions {
  readonly idPrefix?: string;
  readonly signal?: AbortSignal;
  readonly lint: LayoutLintOptions & { readonly measureText: TextMeasure };
  /** 默认在生成副本中修复可确定处理的设计和布局问题，不修改输入模板。 */
  readonly repair?: boolean;
  /** false 允许返回带完整诊断的产物；默认遇到任何布局问题都拒绝。 */
  readonly requireClean?: boolean;
}

export interface TemplateFillBinding {
  readonly slideNumber: number;
  readonly slideId: string;
  readonly layoutId: string;
  readonly titleId: string;
  readonly bodyIds: readonly string[];
  readonly objectId: string | null;
}

export interface TemplateFillResult {
  readonly bytes: Uint8Array;
  readonly description: PresentationDescription;
  readonly lint: LayoutLintReport;
  readonly bindings: readonly TemplateFillBinding[];
  readonly repairs: readonly import('./repair').TemplateRepair[];
}
