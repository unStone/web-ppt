import type { Presentation } from './types';

/** 批注正文放在独立打印页，既能搜索全文，也不会盖住幻灯片或挤压原版式。 */
export function printCommentAppendix(pres: Presentation, escapeXml: (value: string) => string): string {
  return '<style>.ppt-comments{break-before:page;padding:32px;box-sizing:border-box;font:16px/1.5 sans-serif}'
    + '.ppt-comments li{break-inside:avoid;margin:20px 0}.ppt-comments p{white-space:pre-wrap;overflow-wrap:anywhere}</style>'
    + pres.slides.map((slide, index) => !slide.comments?.length ? '' :
      `<section class="ppt-comments" data-slide="${index + 1}"><h2>${index + 1}</h2><ol>`
      + slide.comments.map((comment, i) => `<li value="${escapeXml(String(comment.idx ?? i + 1))}"><b>${escapeXml(comment.author)}</b>`
        + (comment.date ? `<time> · ${escapeXml(comment.date)}</time>` : '')
        + `<p>${escapeXml(comment.text)}</p></li>`).join('') + '</ol></section>').join('');
}

/** 打印排版与正文只在交付 HTML 时加载，默认预览不承担这段模板成本。 */
export function printDocument(
  pres: Presentation, pages: readonly string[], showComments: boolean | undefined, escapeXml: (value: string) => string,
): string {
  return '<!doctype html><html><head><meta charset="utf-8"><title>slides</title><style>'
    + `@page{size:${Math.round(pres.width)}px ${Math.round(pres.height)}px;margin:0}`
    + 'html,body{margin:0;padding:0}'
    + '.pg{page-break-after:always;width:100vw;height:100vh;display:flex;align-items:center;justify-content:center}'
    + '.pg svg{width:100%;height:100%}'
    + '</style></head><body>'
    + pages.map((page) => `<div class="pg">${page}</div>`).join('')
    + (showComments ? printCommentAppendix(pres, escapeXml) : '')
    + '</body></html>';
}
