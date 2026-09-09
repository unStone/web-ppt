import type {FontProviderLimits} from './types';

export type FontValidationPause = () => Promise<void> | undefined;

export function fontLimits(input: Partial<FontProviderLimits> = {}): FontProviderLimits {
  const limits = {maxFontBytes:32 * 1024 * 1024,maxTotalFontBytes:64 * 1024 * 1024,maxFaces:64,
    maxGlyphs:65535,maxTextLength:100_000,...input};
  if (!Object.values(limits).every(value => Number.isSafeInteger(value) && value > 0)) throw new RangeError('Invalid font resource budget');
  return limits;
}

/** 让长校验归还事件循环，AbortSignal 才有机会在注册提交之前生效。 */
export function validationPause(check: () => void): FontValidationPause {
  let deadline = 0;
  return () => {
    check();
    if (Date.now() < deadline) return;
    return new Promise<void>(resolve => setTimeout(resolve,0)).then(() => { check(); deadline = Date.now() + 8; });
  };
}
