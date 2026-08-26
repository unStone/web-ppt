import type { LinkTarget } from '@web-ppt/edit-core';
import type { LinkFollowContext, LinkFollowHandler } from './slide-editor-types';

export function followAdapterLink(
  target: LinkTarget,
  context: LinkFollowContext,
  handler: LinkFollowHandler | undefined,
  setSlide: (slideId: string) => void,
  report: (error: unknown) => void,
): boolean | void {
  try {
    if (handler?.(target, context) === true) return true;
  } catch (error) {
    report(error);
    return undefined;
  }
  if (target.kind !== 'slide') return undefined;
  setSlide(target.slideId);
  return true;
}
