import type { OpcPackage, Slide } from '../types';
import { attr, kid, kids } from '../xml';
import type { DeferredAsset } from './asset-store';
import {
  parseCommentAuthors, parseSlide,
} from './parser';
import { Pkg } from './package-reader';
import { relByType } from './slide-inheritance';

interface LayoutReparseSession {
  pkg: Pkg;
  presRoot: Element;
  tableStyles: Element | null;
  slideIdMap: Record<string, number>;
  authors: ReturnType<typeof parseCommentAuthors>;
}

export interface PptxLayoutReparseResult {
  slide: Slide;
  /** 旧包缺少 sourcePart 索引时产生；调用方必须兑现 slide 内同编号的 asset:N。 */
  assets: readonly DeferredAsset[];
}

const sessions = new WeakMap<OpcPackage, LayoutReparseSession>();

function sessionFor(source: OpcPackage): LayoutReparseSession {
  const cached = sessions.get(source);
  if (cached) return cached;
  if (source.disposed) throw new Error('OPC 包已释放，不能重新求值版式');
  const pkg = new Pkg(source);
  // 重解析会话不拥有 OpcPackage 生命周期，不能创建无法随文档释放的 blob URL。
  pkg.assetMode = 'defer';
  const presPath = 'ppt/presentation.xml';
  const presRoot = pkg.xml(presPath);
  if (!presRoot) throw new Error('无效的 .pptx：找不到 ppt/presentation.xml');
  const presRels = pkg.rels(presPath);
  const tableStylesPath = relByType(presRels, '/tableStyles');
  const slideIdMap: Record<string, number> = {};
  kids(kid(presRoot, 'sldIdLst'), 'sldId').forEach((sldId, index) => {
    const rid = attr(sldId, 'r:id');
    const target = rid ? presRels[rid]?.target : null;
    if (target) slideIdMap[target] = index + 1;
  });
  const session = {
    pkg,
    presRoot,
    tableStyles: tableStylesPath ? pkg.xml(tableStylesPath) : null,
    slideIdMap,
    authors: parseCommentAuthors(pkg, presRels),
  } satisfies LayoutReparseSession;
  sessions.set(source, session);
  return session;
}

/** 按目标版式重解析页面；关系写回前的预览因此与保存重开共用 OOXML 继承语义。 */
export function reparsePptxSlideWithLayout(
  source: OpcPackage,
  slidePath: string,
  layoutPath: string,
  slideNum: number,
): PptxLayoutReparseResult {
  if (!source.parts[slidePath]) throw new Error(`找不到页面 part：${slidePath}`);
  if (!source.parts[layoutPath]) throw new Error(`找不到版式 part：${layoutPath}`);
  const session = sessionFor(source);
  const trace = session.pkg.beginCacheTrace();
  try {
    return {
      slide: parseSlide(
        session.pkg, slidePath, slideNum, session.presRoot, session.tableStyles,
        session.slideIdMap, session.authors, true, layoutPath,
      ),
      assets: session.pkg.deferred,
    };
  } finally {
    // 版式继承树跨页共享；其余实际触碰的图表、VML、SmartArt、备注等属于页面闭包。
    for (const part of session.pkg.endCacheTrace(trace)) {
      const shared = part === 'ppt/presentation.xml'
        || part.startsWith('ppt/slideLayouts/')
        || part.startsWith('ppt/slideMasters/')
        || part.startsWith('ppt/theme/')
        || part.startsWith('ppt/tableStyles');
      if (shared) continue;
      if (part.endsWith('.rels')) session.pkg.forgetXml(part);
      else session.pkg.forgetPart(part);
    }
  }
}

/** EditDoc 显式释放/换包时同步断开对旧 parts 与 XML 缓存的强引用。 */
export function releasePptxLayoutReparseSession(source: OpcPackage): void {
  const session = sessions.get(source);
  if (!session) return;
  session.pkg.dispose();
  sessions.delete(source);
}
