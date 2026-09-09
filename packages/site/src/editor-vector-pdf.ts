import type {Presentation,SlideElement} from '@web-ppt/core';
import type {VectorPdfIssue,VectorPdfOptions} from '@web-ppt/core/pdf/vector';
import type {DocumentFontService} from './editor-document-fonts';
import {fontProblemMessage} from './editor-font-labels';
import {message,type SiteMessage} from './i18n/message';

export async function exportVectorPdf(presentation:Presentation,fonts:DocumentFontService | undefined,
  options:Omit<VectorPdfOptions,'fonts'|'rasterize'|'normalizeImage'>) {
  if (!fonts) throw new Error('Document font service unavailable');
  return fonts.withFonts(options.signal,async reader => {
    const [{presentationToVectorPdf},{rasterizeVectorPdfObject,normalizeVectorPdfImage},{segmentFontText}] = await Promise.all([
      import('@web-ppt/core/pdf/vector'),import('@web-ppt/core/pdf/vector/browser'),import('@web-ppt/fonts/glyphs'),
    ]);
    return presentationToVectorPdf(presentation,{...options,signal:reader.signal,fonts:{provider:reader.provider,segmentText:segmentFontText},
      rasterize:rasterizeVectorPdfObject,normalizeImage:normalizeVectorPdfImage});
  });
}

function objectName(presentation:Presentation,issue:VectorPdfIssue):string | SiteMessage {
  const elements = presentation.slides[issue.slideNumber - 1]?.elements ?? [];
  const find = (items:SlideElement[]):SlideElement | undefined => {
    for (const item of items) {
      if (item.id === issue.elementId) return item;
      if (item.kind === 'group') {const child = find(item.children); if (child) return child;}
    }
  };
  if (issue.elementId !== undefined) return find(elements)?.name || message('导出对象 {id}',{id:issue.elementId});
  if (issue.elementPath) {
    let items = elements, element:SlideElement | undefined;
    for (const index of issue.elementPath) {element = items[index]; items = element?.kind === 'group' ? element.children : [];}
    return element?.name || message('导出对象 {id}',{id:issue.elementPath.map(i => i + 1).join('.')});
  }
  return message('幻灯片背景');
}
const location = (presentation:Presentation,issue:VectorPdfIssue,reason:SiteMessage) =>
  message('第 {page} 页 · {object}：{reason}',{page:issue.slideNumber,object:objectName(presentation,issue),reason});

export function vectorPdfFailure(presentation:Presentation,error:unknown):SiteMessage {
  const issue = error && typeof error === 'object' && 'issue' in error ? error.issue as VectorPdfIssue : undefined;
  if (!issue) return message('矢量 PDF 导出未完成，请重试或改用图片 PDF');
  let reason:SiteMessage;
  if (issue.fontFamilies) reason = message('字体 {families}：{reason}。请关闭导出窗口，在“字体与缺字”中检查或加载字体',{
    families:issue.fontFamilies.join('、'),reason:fontProblemMessage(issue.reason),
  });
  else if (issue.reason === 'image-byte-limit' || issue.reason === 'image-pixel-limit' || issue.reason === 'image-count-limit') {
    reason = message('图片超过导出处理上限，请缩小图片后重试');
  } else if (issue.reason.startsWith('image-')) reason = message('图片无法读取或转换，请检查图片后重试');
  else reason = message('该内容暂时无法矢量导出，可改用图片 PDF');
  return location(presentation,issue,reason);
}

export function vectorPdfNotices(presentation:Presentation,issues:VectorPdfIssue[]):SiteMessage[] {
  const notices = issues.slice(0,100).map(issue => location(presentation,issue,message('已用图片保留该对象的特殊效果')));
  if (issues.length > 100) notices.push(message('另有 {count} 个对象使用图片保留效果',{count:issues.length - 100}));
  return notices;
}
