/**
 * 新建图表的 graphicFrame 片段（裸字符串，前缀由插入的 namespaces 声明）。
 * 关系引用用命令内分配的 sourceId 占位，保存物化时重映射为部件真实 rId
 * （见 save/insertion.ts）。现代图（ChartEx）按 PowerPoint 惯例写
 * mc:AlternateContent：Choice 指向 cx 部件，Fallback 指向经典图部件。
 */
import type { InsertionRect } from '../commands/insertion-rect';
import { pxToEmu } from '../commands/insertion-rect';

export interface GraphicFrameOptions {
  readonly shapeId: number;
  readonly name: string;
  readonly rect: InsertionRect;
  readonly relationshipId: string;
  readonly fallbackRelationshipId?: string;
  readonly modern: boolean;
}

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function seedGraphicFrameMarkup(options: GraphicFrameOptions): {
  readonly value: string;
  readonly fallbackRelationshipId?: string;
} {
  const name = escapeAttribute(options.name);
  // 每个分支的 graphicFrame 自带命名空间声明：OOXML 门禁按 MCE 读端语义展开
  // AlternateContent 时克隆的是 Fallback 子树，祖先上的声明不会跟随。
  const frame = (relationshipId: string, modernChart: boolean) =>
    `<p:graphicFrame xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex">`
    + `<p:nvGraphicFramePr><p:cNvPr id="${options.shapeId}" name="${name}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>`
    + `<p:xfrm><a:off x="${pxToEmu(options.rect.x)}" y="${pxToEmu(options.rect.y)}"/><a:ext cx="${pxToEmu(options.rect.w)}" cy="${pxToEmu(options.rect.h)}"/></p:xfrm>`
    + (modernChart
      ? `<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2014/chartex"><cx:chart r:id="${relationshipId}"/></a:graphicData></a:graphic></p:graphicFrame>`
      : `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="${relationshipId}"/></a:graphicData></a:graphic></p:graphicFrame>`);
  if (options.modern && options.fallbackRelationshipId) {
    return {
      value:
        `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">`
        + `<mc:Choice Requires="modern">${frame(options.relationshipId, true)}</mc:Choice>`
        + `<mc:Fallback>${frame(options.fallbackRelationshipId, false)}</mc:Fallback></mc:AlternateContent>`,
      fallbackRelationshipId: options.fallbackRelationshipId,
    };
  }
  return { value: frame(options.relationshipId, false) };
}
