import { parseSafeExternalUrl } from '../types';

const esc = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function hyperlinkAttributes(link: string): string {
  if (link.startsWith('slide:')) {
    return `data-slide="${esc(link.slice(6))}" tabindex="0" role="link" style="cursor:pointer;text-decoration:underline"`;
  }
  if (!parseSafeExternalUrl(link)) {
    // 畸形来源仍可由属性面板读取，但永远不给浏览器导航能力。
    return `data-unsafe-href="${esc(link)}" aria-disabled="true"`;
  }
  return `href="${esc(link)}" target="_blank" rel="noopener noreferrer"`;
}

export function withHyperlink(markup: string, link: string | undefined): string {
  return link ? `<a ${hyperlinkAttributes(link)}>${markup}</a>` : markup;
}
