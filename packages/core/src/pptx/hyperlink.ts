import { parseSafeExternalUrl } from '../types';
import { attr, kid } from '../xml';
import type { Env } from './slide-inheritance';

export function resolveLink(env: Env, rid: string, action: string | null): string | null {
  if (action?.includes('nextslide')) return env.edit ? 'slide:next' : `slide:${env.slideNum + 1}`;
  if (action?.includes('previousslide')) return env.edit ? 'slide:previous' : `slide:${env.slideNum - 1}`;
  if (action?.includes('firstslide')) return env.edit ? 'slide:first' : 'slide:1';
  if (action?.includes('lastslide')) return 'slide:last';
  const rel = env.rels[rid];
  if (!rel) return null;
  if (parseSafeExternalUrl(rel.target)) return rel.target;
  const index = env.slideIdMap[rel.target];
  if (index === undefined) return null;
  return env.edit ? `slide-part:${encodeURIComponent(rel.target)}` : `slide:${index}`;
}

export function hyperlinkOf(cNvPr: Element | null, env: Env): {
  readonly link?: string;
  readonly unsupported: boolean;
} {
  const hyperlink = kid(cNvPr, 'hlinkClick');
  if (!hyperlink) return { unsupported: false };
  const link = resolveLink(env, attr(hyperlink, 'r:id') ?? '', attr(hyperlink, 'action')) ?? undefined;
  return { ...(link ? { link } : {}), unsupported: !link };
}
