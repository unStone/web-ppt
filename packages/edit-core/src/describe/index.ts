import type { EditDoc } from '@web-ppt/edit-core';
import { applyBudget, validateBudget } from './budget';
import { readDescription } from './read';
import type { DescribeOptions, PresentationDescription } from './types';

export function describePresentation(doc: EditDoc, options: DescribeOptions = {}): PresentationDescription {
  validateBudget(options);
  return applyBudget(readDescription(doc), options);
}

export { DescribeError } from './types';
export type {
  DescribeFailureReason, DescribeOptions, DescriptionElement, DescriptionParagraph,
  DescriptionPlaceholder, DescriptionReference, DescriptionSlide, PresentationDescription,
} from './types';
