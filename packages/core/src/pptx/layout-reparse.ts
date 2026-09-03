import type { OpcPackage, Slide, SlideLayoutTemplate } from '../types';
import { attr, kid, kids } from '../xml';
import type { DeferredAsset } from './asset-store';
import {
  parseCommentAuthors, parseLayoutCatalog, parseSlide,
} from './parser';
import { Pkg } from './package-reader';
import { relByType } from './slide-inheritance';
import { parseThemeCatalog } from './theme-catalog';

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

export interface PptxLayoutTemplateReparseResult {
  layout: SlideLayoutTemplate;
  /** 旧包缺少资源索引时产生；调用方必须兑现 layout 内同编号的 asset:N。 */
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

/** 主题内存覆盖后的版式目录必须重走 core 解析，不能在 edit-core 复制颜色与字体继承。 */
export function reparsePptxLayoutTemplate(
  source: OpcPackage,
  layoutPath: string,
): PptxLayoutTemplateReparseResult {
  if (!source.parts[layoutPath]) throw new Error(`找不到版式 part：${layoutPath}`);
  const session = sessionFor(source);
  const trace = session.pkg.beginCacheTrace();
  try {
    const presRels = session.pkg.rels('ppt/presentation.xml');
    const themes = parseThemeCatalog(
      session.presRoot, presRels,
      (path) => session.pkg.xml(path), (path) => session.pkg.rels(path),
    );
    const layout = parseLayoutCatalog(
      session.pkg, session.presRoot, presRels, session.tableStyles,
      session.slideIdMap, themes.themeByMaster,
    ).find((candidate) => candidate.id === layoutPath);
    if (!layout) throw new Error(`版式目录不存在：${layoutPath}`);
    return { layout, assets: session.pkg.deferred };
  } finally {
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
