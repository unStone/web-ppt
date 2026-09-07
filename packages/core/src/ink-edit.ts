import { parseXml } from './xml';
import { inkStrokes } from './ink/render';
export { readInkData, decodeInkPoints } from './ink/model';
export type { InkPoint, InkStroke, InkData } from './ink/model';
export function renderInkXml(xml: string, width: number, height: number) { return inkStrokes(parseXml(xml), width, height); }
