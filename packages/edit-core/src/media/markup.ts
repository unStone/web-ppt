import type { InsertionRect } from '../commands/insertion-rect';
import { pxToEmu } from '../commands/insertion-rect';
import { DRAWINGML_NS, PRESENTATIONML_NS } from '../xml/qname';
import { OFFICE_MEDIA_REL, POWERPOINT_2010_NS, mediaPropertiesMarkup } from '../media-properties';

export const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const MEDIA_REL = OFFICE_MEDIA_REL;
export const MEDIA_NAMESPACES = {
  'xmlns:a': DRAWINGML_NS, 'xmlns:p': PRESENTATIONML_NS, 'xmlns:r': OFFICE_REL,
  'xmlns:p14': POWERPOINT_2010_NS,
};

export function mediaMarkup(spid: number, rect: InsertionRect, kind: 'audio' | 'video'): string {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${spid}" name="${kind === 'audio' ? '音频' : '视频'}"/><p:cNvPicPr/>
<p:nvPr>${mediaPropertiesMarkup(kind, 'rIdSource', 'rIdMedia')}</p:nvPr></p:nvPicPr>
<p:blipFill><a:blip r:embed="rIdPoster"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${pxToEmu(rect.x)}" y="${pxToEmu(rect.y)}"/><a:ext cx="${pxToEmu(rect.w)}" cy="${pxToEmu(rect.h)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}
