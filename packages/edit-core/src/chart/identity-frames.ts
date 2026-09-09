import type { EditDoc, ElementId } from '../types';
import { parseXmlTree } from '@web-ppt/edit-core/xml';
import { chartPartForElement, chartFrameKey } from './locator';
import { readChartIdentityManifest } from './identity';
import type { ChartIdentityScopes } from './identity-scopes';

/** 部件只保存一份数据；原框架的身份前缀按 OPC 定位持久化，避免重开时都变成首框架的身份。 */
export function chartIdentityScopes(doc: EditDoc, part: string, source: Uint8Array, owner: ElementId): ChartIdentityScopes | undefined {
  const root = parseXmlTree(source).root;
  const frames = Object.values(doc.elements).filter(record => chartPartForElement(doc, record.id) === part);
  const manifest = readChartIdentityManifest(root, chartFrameKey(doc, owner), owner);
  if (frames.length < 2 && !manifest?.scopes) return undefined;
  return { prefix: manifest?.scopes?.prefix ?? owner,
    frames: frames.map(record => [chartFrameKey(doc, record.id),
      readChartIdentityManifest(root, chartFrameKey(doc, record.id), record.id)?.scopes?.prefix ?? record.id] as const)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0) };
}
