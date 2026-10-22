import { DescribeError } from './types';
import type { DescribeOptions, DescriptionElement, DescriptionSlide, PresentationDescription } from './types';

export function validateBudget(options: DescribeOptions): void {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new DescribeError('invalid-budget', 'describe.options 必须为预算选项对象');
  }
  for (const key of ['maxChars', 'maxTokens'] as const) {
    const value = options[key];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new DescribeError('invalid-budget', `describe.${key} 实际为 ${String(value)}，必须为非负安全整数`);
    }
  }
  if (options.maxTokens !== undefined && typeof options.countTokens !== 'function') {
    throw new DescribeError('token-counter-required', 'describe.maxTokens 必须同时提供目标模型的 countTokens(json)');
  }
}

export function applyBudget(full: PresentationDescription, options: DescribeOptions): PresentationDescription {
  if (options.maxChars === undefined && options.maxTokens === undefined) return full;
  const overflow = (result: PresentationDescription): 'max-chars' | 'max-tokens' | null => {
    const json = JSON.stringify(result);
    // 即使字符预算已超限，也验证调用方计数结果，避免错误分词器伪装成正常截断。
    let tokens = 0;
    if (options.maxTokens !== undefined) {
      try { tokens = options.countTokens!(json); }
      catch (error) {
        throw new DescribeError('token-count-failed', `describe.countTokens 执行失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!Number.isSafeInteger(tokens) || tokens < 0) {
      throw new DescribeError('invalid-token-count', `describe.countTokens 实际返回 ${String(tokens)}，必须为非负安全整数`);
    }
    return options.maxChars !== undefined && json.length > options.maxChars ? 'max-chars'
      : options.maxTokens !== undefined && tokens > options.maxTokens ? 'max-tokens' : null;
  };
  const reason = overflow(full);
  if (!reason) return full;
  const totalUnits = full.totalElements + full.totalSlides;
  const prefix = (units: number): PresentationDescription => {
    const slides: DescriptionSlide[] = [];
    let elements = 0, remaining = units;
    let next: PresentationDescription['truncation']['next'] = null;
    for (const slide of full.slides) {
      if (!remaining) { next = { slideNumber: slide.number, elementId: null }; break; }
      remaining--;
      const take = Math.min(remaining, slide.elements.length);
      const kept: DescriptionElement[] = slide.elements.slice(0, take);
      slides.push({ ...slide, elements: kept });
      elements += take;
      remaining -= take;
      if (take < slide.elements.length) {
        next = { slideNumber: slide.number, elementId: slide.elements[take].id }; break;
      }
    }
    return {
      ...full, slides,
      truncation: { reason, omittedSlides: full.totalSlides - slides.length, omittedElements: full.totalElements - elements, next },
    };
  };
  let result = prefix(0);
  if (overflow(result)) throw new DescribeError('budget-too-small', `describe 的 ${reason} 预算不足以容纳最小结果及截断定位`);
  let low = 0, high = totalUnits - 1;
  // 对数次完整计数避免大文稿逐元素重算分词；只承诺确定且不超预算的前缀，不承诺耗尽每个 token。
  while (low < high) {
    const middle = Math.ceil((low + high) / 2), candidate = prefix(middle);
    if (overflow(candidate)) high = middle - 1;
    else { low = middle; result = candidate; }
  }
  return result;
}
