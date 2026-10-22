import type { DescriptionElement } from '../describe/types';
export const LAYOUT_CHECKS = ['text-overflow', 'element-overlap', 'off-canvas', 'low-contrast', 'missing-font', 'placeholder-prompt-left', 'image-distorted'] as const;
export type LayoutCheck = typeof LAYOUT_CHECKS[number];
export interface LayoutIssue {
  readonly reason: LayoutCheck;
  readonly slideNumber: number;
  readonly elementId: string;
  readonly bounds: DescriptionElement['bounds'];
  readonly cell: { readonly row: number; readonly column: number } | null;
  readonly measurements: Readonly<Record<string, number | string | boolean | readonly string[]>>;
}
export interface LayoutLintReport {
  readonly version: 1;
  readonly checks: readonly LayoutCheck[];
  readonly totalSlides: number;
  readonly totalElements: number;
  readonly issues: readonly LayoutIssue[];
}
