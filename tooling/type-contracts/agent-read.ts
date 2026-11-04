import type { TextMeasure } from '@web-ppt/core';
import type { EditDoc } from '@web-ppt/edit-core';
import {
  describePresentation, DescribeError,
  type DescribeOptions, type PresentationDescription,
} from '@web-ppt/edit-core/describe';
import {
  lintPresentation, LayoutLintError,
  type LayoutIssue, type LayoutLintOptions, type LayoutLintReport,
} from '@web-ppt/edit-core/lint';
import { createSvgContrastSampler } from '@web-ppt/edit-core/lint/sampler';

export async function agentReadContract(doc: EditDoc, measureText: TextMeasure): Promise<LayoutLintReport> {
  const budget: DescribeOptions = { maxChars: 8_000, maxTokens: 2_000, countTokens: json => json.length };
  const description: PresentationDescription = describePresentation(doc, budget);
  const version: 1 = description.version;
  const nextId: string | null | undefined = description.truncation.next?.elementId;
  const options: LayoutLintOptions = {
    checks: ['text-overflow', 'low-contrast'], measureText,
    fonts: { available: ['Arial'], embedded: [] },
    resolveContrast: createSvgContrastSampler({
      rasterize: async (_svg, width, height, signal) => {
        signal?.throwIfAborted();
        return new Uint8ClampedArray(width * height * 4);
      },
    }),
    onProgress: async ({ completed, total }) => { void [completed, total]; },
  };
  void [version, nextId];
  return lintPresentation(doc, options);
}

export function agentReadFailures(doc: EditDoc, issue: LayoutIssue): void {
  // @ts-expect-error 预算按字符数计，不能传入字符串。
  describePresentation(doc, { maxChars: '8000' });
  // @ts-expect-error describe 错误原因属于固定公开集合。
  new DescribeError('unknown-reason', '无效错误');
  const description = describePresentation(doc);
  // @ts-expect-error 读出结果不允许宿主修改元素顺序。
  description.slides.push(description.slides[0]);
  // @ts-expect-error 未公开的检查名不能进入 lint 请求。
  void lintPresentation(doc, { checks: ['unknown-check'] });
  // @ts-expect-error 对比度观察必须返回前景/背景配对或不可见标记。
  void lintPresentation(doc, { resolveContrast: () => '#ffffff' });
  // @ts-expect-error 诊断测量结果属于只读观察。
  issue.measurements.value = 1;
}

export function readErrorDetails(error: DescribeError | LayoutLintError): readonly [string, number | null, string | null] {
  return [error.reason, error.slideNumber, error.elementId];
}
