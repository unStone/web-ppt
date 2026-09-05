export const OFFICE_MEDIA_REL = 'http://schemas.microsoft.com/office/2007/relationships/media';
export const POWERPOINT_2010_NS = 'http://schemas.microsoft.com/office/powerpoint/2010/main';

/** 经典关系服务旧版 Office，p14 关系服务新版媒体；二者必须指向同一来源。 */
export function mediaPropertiesMarkup(
  kind: 'audio' | 'video', classicId?: string, compatibleId?: string, external = false,
): string {
  return `<a:${kind}File${classicId ? ` r:link="${classicId}"` : ''}/>`
    + (compatibleId ? `<p:extLst><p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}"><p14:media r:${external ? 'link' : 'embed'}="${compatibleId}"/></p:ext></p:extLst>` : '');
}
