import type { Slide } from '@web-ppt/core';
import { toLayoutCanvas } from './layout';
import { toMasterCanvas } from './master';
import type { DesignTarget, EditDoc } from './types';

export function toDesignCanvas(doc: EditDoc, target: DesignTarget): Slide {
  return target.kind === 'layout'
    ? toLayoutCanvas(doc, target)
    : toMasterCanvas(doc, target);
}
