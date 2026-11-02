import type { LayoutLintReport } from '../lint/types';

export class TemplateFillError extends Error {
  constructor(
    readonly reason: string,
    message: string,
    readonly slideNumber: number | null = null,
    readonly field: string | null = null,
    readonly elementId: string | null = null,
    readonly lint?: LayoutLintReport,
  ) {
    super(message);
    this.name = 'TemplateFillError';
  }
}

export function requireActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new TemplateFillError('aborted', '模板填充已取消');
}
