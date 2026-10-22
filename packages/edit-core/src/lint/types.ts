import type { ImageMetadata, Paragraph, Slide, SlideElement, TextBody, TextMeasure, TextRun } from '@web-ppt/core';
import type { LayoutCheck } from './report';
export { LAYOUT_CHECKS } from './report';
export type { LayoutCheck, LayoutIssue, LayoutLintReport } from './report';
export interface LintContext {
  readonly slideNumber: number;
  readonly elementId: string;
  readonly element: Readonly<SlideElement>;
  readonly slide: Readonly<Slide>;
  readonly canvas: { readonly width: number; readonly height: number; readonly color: string };
  readonly resource: (url: string) => { readonly bytes: Uint8Array; readonly mime: string } | undefined;
  readonly bindings: readonly { readonly elementId: string; readonly element: Readonly<SlideElement> }[];
  readonly signal?: AbortSignal;
}
export interface ContrastContext extends LintContext {
  readonly body: Readonly<TextBody>;
  readonly paragraph: Readonly<Paragraph>;
  readonly run: Readonly<TextRun>;
  readonly textIndex: number;
  readonly paragraphIndex: number;
  readonly runIndex: number;
}
export interface LayoutLintOptions {
  readonly checks?: readonly LayoutCheck[];
  readonly measureText?: TextMeasure;
  readonly fonts?: { readonly available: readonly string[]; readonly embedded: readonly string[] };
  readonly canvasColor?: string;
  readonly overlapRatio?: number;
  readonly imageDeviation?: number;
  readonly tolerancePx?: number;
  readonly maxIssues?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: { completed: number; total: number }) => void | Promise<void>;
  readonly resolveContrast?: (context: ContrastContext) => ContrastSamples | Promise<ContrastSamples>;
  readonly resolveImageMetadata?: (context: LintContext) => ImageMetadata | undefined | Promise<ImageMetadata | undefined>;
  readonly resolvePlaceholderPrompts?: (context: LintContext) => readonly string[] | undefined | Promise<readonly string[] | undefined>;
}
export type ContrastSamples = readonly { foreground: string; background: string }[] | { readonly visible: false };
export class LayoutLintError extends Error {
  constructor(readonly reason: string, message: string, readonly slideNumber: number | null = null, readonly elementId: string | null = null) {
    super(message); this.name = 'LayoutLintError';
  }
}
export function active(signal?: AbortSignal): void {
  if (signal?.aborted) throw new LayoutLintError('aborted', '布局检查已取消');
}
export async function waitFor<T>(value: T | Promise<T>, signal?: AbortSignal): Promise<T> {
  active(signal);
  if (!signal) return value;
  let abort: () => void = () => {};
  try {
    return await Promise.race([Promise.resolve(value), new Promise<never>((_, reject) => {
      abort = () => reject(new LayoutLintError('aborted', '布局检查已取消'));
      signal.addEventListener('abort', abort, { once: true });
    })]);
  } finally { signal.removeEventListener('abort', abort); }
}
