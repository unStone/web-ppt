/**
 * .pptx 解析入口：演示文稿包 → 幻灯片 / 版式 / 母版目录 → 统一 Schema。
 * 形状树见 shapes.ts，graphicFrame 见 graphic-frame.ts，共用属性见 shape-props.ts，批注见 comments.ts。
 */
import type { EmbeddedFont, Fill, Presentation, Slide, SlideElement, TextBody } from '../types';
import { attr, boolAttr, emu, kid, kids, numAttr, walk } from '../xml';
import { childColor } from './color';
import { parseSlideTiming, parseTransition } from './animation';
import { completeTextTemplateLevels } from './text-template';
import type { AssetMode, DeferredAsset } from './asset-store';
import type { ZipLimitOptions } from '../zip';
import {
  layoutCatalogPaths, layoutPlaceholderTemplate, masterCatalogPaths,
} from './layout-catalog';
import {
  Env, masterInheritance, relByType, Rels, slideInheritance, SlideInheritance,
} from './slide-inheritance';
import type { SharedDocDefaults } from './slide-inheritance';
import { Pkg } from './package-reader';
import { defaultTableEditInfo, tableStyleCatalog } from './table-style';
import { parseSections } from './sections';
import { parseThemeCatalog } from './theme-catalog';
import { compatibilityAssets, releaseCompatibilitySource } from './compatibility-source';
import {
  TABLE_FORMAT_READER, defaultShapeEditInfo, parseFillElement, parseFillProps, withPhClr,
} from './shape-props';
import { parseShapeTree } from './shapes';
import { AuthorInfo, parseCommentAuthors, parseSlideComments } from './comments';

export type { AssetMode, DeferredAsset } from './asset-store';

// ---------------- 幻灯片 ----------------

function extractNotesText(root: Element | null): string {
  const tree = walk(root, 'cSld', 'spTree');
  for (const shape of kids(tree, 'sp')) {
    const placeholder = walk(kid(shape, 'nvSpPr'), 'nvPr', 'ph');
    if (attr(placeholder, 'type') !== 'body') continue;
    const body = kid(shape, 'txBody');
    return kids(body, 'p').map((paragraph) => {
      const text: string[] = [];
      const descendants = paragraph.getElementsByTagName('*');
      for (let index = 0; index < descendants.length; index++) {
        const node = descendants[index];
        if (node.localName === 't') text.push(node.textContent ?? '');
        else if (node.localName === 'br') text.push('\n');
        else if (node.localName === 'tab' && attr(node, 'pos') === null) text.push('\t');
      }
      return text.join('');
    }).join('\n');
  }
  return '';
}

function parseEmbeddedFonts(pkg: Pkg, presRoot: Element, presRels: Rels, sources?: EmbeddedFont[], decode = true): EmbeddedFont[] {
  const out: EmbeddedFont[] = [];
  for (const ef of kids(kid(presRoot, 'embeddedFontLst'), 'embeddedFont')) {
    const family = attr(kid(ef, 'font'), 'typeface');
    if (!family) continue;
    for (const [tag, bold, italic] of [['regular', false, false], ['bold', true, false], ['italic', false, true], ['boldItalic', true, true]] as const) {
      const rid = attr(kid(ef, tag), 'r:id');
      const target = rid ? presRels[rid]?.target : null;
      const url = decode && target ? pkg.fontUrl(target) : null;
      if (url) out.push({ family, src: url, bold, italic });
      const source = sources && target ? pkg.fontSourceUrl(target) : null;
      if (source) sources!.push({family,src:source,bold,italic});
    }
  }
  return out;
}

export interface PptxParseOptions {
  embeddedFonts?: 'decode' | 'source';
  /**
   * 惰性解析幻灯片（默认开启）。
   * `slides` 仍是普通数组，`length` 与遍历行为不变，只是每一项在首次读取时才真正解析。
   * 设为 false 可拿到「全部解析完毕」的纯数据对象——需要 `structuredClone`
   * 或 `JSON.stringify` 整份演示文稿时更省心。
   */
  lazy?: boolean;
  /** 为页与元素保留 OOXML 回写锚点和占位符身份；默认关闭 */
  edit?: boolean;
  /** 保留原始 ZIP 与解压 part，通过 `Presentation.package` 暴露；默认关闭 */
  keepPackage?: boolean;
  /** 覆盖 ZIP 条目数、声明大小、实际输出与压缩比安全上限 */
  zip?: ZipLimitOptions;
  /**
   * 资源产出方式。`defer` 下图片不建 blob URL，而是发 `asset:N` 令牌并把字节
   * 收进 `assets`，供 Worker 把结果传回主线程后再兑现成真实 URL。
   */
  assets?: AssetMode;
}

/** Worker 模式下的解析结果：Schema 里是 asset:N 令牌，字节单独带出 */
export interface PptxParseResult {
  presentation: Presentation;
  assets: DeferredAsset[];
}

export function parsePptxDeferred(bytes: Uint8Array, zip?: ZipLimitOptions): PptxParseResult {
  const pkg = new Pkg(bytes, false, zip);
  pkg.assetMode = 'defer';
  const presentation = buildPresentation(pkg, { lazy: false, assets: 'defer' });
  return { presentation, assets: pkg.deferred };
}

export function parsePptx(bytes: Uint8Array, opts: PptxParseOptions = {}): Presentation {
  const pkg = new Pkg(bytes, opts.keepPackage === true, opts.zip);
  if (opts.assets === 'defer') pkg.assetMode = 'defer';
  return buildPresentation(pkg, opts);
}

function buildPresentation(pkg: Pkg, opts: PptxParseOptions): Presentation {
  const presPath = 'ppt/presentation.xml';
  const presRoot = pkg.xml(presPath);
  if (!presRoot) throw new Error('无效的 .pptx：找不到 ppt/presentation.xml');
  const presRels = pkg.rels(presPath);

  const sldSz = kid(presRoot, 'sldSz');
  const width = emu(numAttr(sldSz, 'cx') ?? 12192000);
  const height = emu(numAttr(sldSz, 'cy') ?? 6858000);

  const tableStylesPath = relByType(presRels, '/tableStyles');
  const tableStyles = tableStylesPath ? pkg.xml(tableStylesPath) : null;
  const docDefaults: SharedDocDefaults = new Map();

  const slideIds = kids(kid(presRoot, 'sldIdLst'), 'sldId');

  // 幻灯片路径 → 页码，用于内部超链接
  const slideIdMap: Record<string, number> = {};
  const idToIndex = new Map<number, number>();
  slideIds.forEach((sldId, i) => {
    const rid = attr(sldId, 'r:id');
    const target = rid ? presRels[rid]?.target : null;
    if (target) slideIdMap[target] = i + 1;
    const id = numAttr(sldId, 'id');
    if (id !== null) idToIndex.set(id, i);
  });

  const authors = parseCommentAuthors(pkg, presRels);

  // 有效的幻灯片路径（缺 rels 的条目直接跳过，保证下标连续）
  const slidePaths: string[] = [];
  for (const sldId of slideIds) {
    const rid = attr(sldId, 'r:id');
    const target = rid ? presRels[rid]?.target : null;
    if (target) slidePaths.push(target);
  }

  const failed = (i: number, err: unknown): Slide => ({
    background: { type: 'solid', color: 'rgb(255,255,255)' },
    elements: [{
      kind: 'unsupported', x: width * 0.1, y: height * 0.4, w: width * 0.8, h: height * 0.2,
      rot: 0, flipH: false, flipV: false,
      label: `第 ${i + 1} 页解析失败：${err instanceof Error ? err.message : String(err)}`,
    }],
    ...(opts.edit ? { editInfo: { origin: { part: slidePaths[i] } } } : {}),
  });

  const buildSlide = (i: number): Slide => {
    try {
      return parseSlide(
        pkg, slidePaths[i], i + 1, presRoot, tableStyles, slideIdMap, authors, opts.edit === true,
        undefined, docDefaults,
      );
    } catch (err) {
      return failed(i, err);
    }
  };

  let slides: Slide[];
  if (opts.lazy === false) {
    slides = slidePaths.map((_, i) => buildSlide(i));
  } else {
    // 惰性：只在首次访问某页时才解析它。
    // 200 页的文件首屏因此从「解析全部」降到「解析 1 页」，实测快约 11 倍。
    slides = new Array<Slide>(slidePaths.length);
    slidePaths.forEach((_, i) => {
      let cached: Slide | undefined;
      Object.defineProperty(slides, i, {
        enumerable: true,
        configurable: true,
        get(): Slide {
          if (cached === undefined) cached = buildSlide(i);
          return cached;
        },
        set(v: Slide) {
          cached = v;
        },
      });
    });
  }

  const sections = parseSections(presRoot, idToIndex);
  const themeCatalog = opts.edit
    ? parseThemeCatalog(presRoot, presRels, (path) => pkg.xml(path), (path) => pkg.rels(path))
    : undefined;
  const layouts = themeCatalog
    ? parseLayoutCatalog(pkg, presRoot, presRels, tableStyles, slideIdMap, themeCatalog.themeByMaster)
    : undefined;
  const masters = themeCatalog
    ? parseMasterCatalog(pkg, presRoot, presRels, tableStyles, slideIdMap, themeCatalog.themeByMaster)
    : undefined;

  const opcPackage = pkg.opcPackage;
  const embeddedFontSources: EmbeddedFont[] | undefined = opts.edit || opts.embeddedFonts === 'source' ? [] : undefined;
  const embeddedFonts = parseEmbeddedFonts(pkg,presRoot,presRels,embeddedFontSources,opts.embeddedFonts !== 'source');
  return {
    width, height, slides, source: 'pptx',
    dispose: () => { releaseCompatibilitySource(pkg); pkg.dispose(); },
    ...(opcPackage ? { package: opcPackage } : {}),
    embeddedFonts,
    ...(embeddedFontSources?.length ? {embeddedFontSources} : {}),
    sections: sections.length ? sections : undefined,
    ...(layouts && masters ? { editInfo: {
      layouts,
      masters,
      themes: themeCatalog!.themes,
      // 延迟页在 createDoc 时才解析；资源目录必须等页面投影完成后再读取。
      get assets() { return compatibilityAssets(pkg); },
      ...(tableStylesPath ? { tableStylesPart: tableStylesPath } : {}),
    } } : {}),
  };
}

function masterTextTemplate(
  env: Env,
  category: keyof Env['masterStyles'],
): TextBody {
  const seed: TextBody = {
    anchor: 'top', insets: [0, 0, 0, 0], wrap: true, fontScale: 1, paragraphs: [],
  };
  return completeTextTemplateLevels(seed, {
    ctx: env.ctx,
    fonts: env.theme.fonts,
    chain: [env.docDefaults, env.masterStyles[category]],
    slideNum: 1,
    edit: true,
  });
}

export function parseMasterCatalog(
  pkg: Pkg,
  presRoot: Element,
  presRels: Rels,
  tableStyles: Element | null,
  slideIdMap: Record<string, number>,
  themeByMaster: Readonly<Record<string, string>>,
): NonNullable<Presentation['editInfo']>['masters'] {
  return masterCatalogPaths(
    presRoot, presRels, (path) => pkg.xml(path), (path) => pkg.rels(path),
  ).flatMap(({ part, layoutIds }) => {
    const inheritance = masterInheritance(
      pkg, part, presRoot, tableStyles, slideIdMap, 1, true,
    );
    if (!inheritance.masterRoot || inheritance.masterPath !== part) return [];
    const env = inheritance.envFor(part, false);
    return [{
      id: part,
      name: attr(walk(inheritance.masterRoot, 'cSld'), 'name') ?? part,
      ...(themeByMaster[part] ? { themeId: themeByMaster[part] } : {}),
      layoutIds: [...layoutIds],
      background: resolvedSlideBackground(inheritance.masterRoot, part, inheritance),
      elements: parseShapeTree(inheritance.masterTree, env, false),
      textStyles: {
        title: masterTextTemplate(env, 'title'),
        body: masterTextTemplate(env, 'body'),
        other: masterTextTemplate(env, 'other'),
      },
      defaultShape: defaultShapeEditInfo(env)!,
      defaultTable: defaultTableEditInfo(env, TABLE_FORMAT_READER),
      tableStyles: tableStyleCatalog(tableStyles, env, TABLE_FORMAT_READER),
    }];
  });
}

function resolvedSlideBackground(
  slideRoot: Element | null,
  slidePath: string | null,
  inheritance: SlideInheritance,
): Fill | null {
  const { layoutRoot, layoutPath, masterRoot, masterPath, envFor } = inheritance;
  for (const [root, path] of [[slideRoot, slidePath], [layoutRoot, layoutPath], [masterRoot, masterPath]] as const) {
    const bg = walk(root, 'cSld', 'bg');
    if (!bg || !path) continue;
    const env = envFor(path, false);
    const bgPr = kid(bg, 'bgPr');
    if (bgPr) {
      const fill = parseFillProps(bgPr, env);
      if (fill) return fill;
      continue;
    }
    const bgRef = kid(bg, 'bgRef');
    if (!bgRef) continue;
    const idx = Number(attr(bgRef, 'idx') ?? '0');
    const phClr = childColor(bgRef, env.ctx);
    // ST_StyleMatrixColumnIndex：1001 起是 bgFillStyleLst 的第 1 项，1–999 指向 fillStyleLst。
    // 把 1001 直接夹到列表末项，会把最常见的 bg1 纯白背景画成主题第三档渐变。
    const styles = idx > 1000 ? env.theme.bgFillStyles : env.theme.fillStyles;
    const position = idx > 1000 ? idx - 1000 : idx;
    const styleEl = position > 0 ? styles[Math.min(position, styles.length) - 1] ?? null : null;
    const fill = styleEl
      ? parseFillElement(styleEl, withPhClr(env, phClr))
      : (phClr ? { type: 'solid' as const, color: phClr } : null);
    if (fill) return fill;
  }
  return null;
}

export function parseLayoutCatalog(
  pkg: Pkg,
  presRoot: Element,
  presRels: Rels,
  tableStyles: Element | null,
  slideIdMap: Record<string, number>,
  themeByMaster: Readonly<Record<string, string>>,
): NonNullable<Presentation['editInfo']>['layouts'] {
  const layoutPaths = layoutCatalogPaths(
    presRoot, presRels, (path) => pkg.xml(path), (path) => pkg.rels(path),
  );
  return layoutPaths.flatMap((layoutPath) => {
    const inheritance = slideInheritance(
      pkg, null, layoutPath, presRoot, tableStyles, slideIdMap, 1, true,
    );
    if (!inheritance.layoutRoot || !inheritance.masterPath) return [];
    const staticElements: SlideElement[] = [];
    if (boolAttr(inheritance.layoutRoot, 'showMasterSp', true)) {
      staticElements.push(...parseShapeTree(
        inheritance.masterTree, inheritance.envFor(inheritance.masterPath, false), true,
      ));
    }
    // showMasterSp 只屏蔽母版图形；版式自身的背景图形始终属于该版式。
    staticElements.push(...parseShapeTree(
      inheritance.layoutTree, inheritance.envFor(layoutPath, false), true,
    ));
    const placeholders = parseShapeTree(
      inheritance.layoutTree,
      { ...inheritance.envFor(layoutPath, true), layoutCatalog: true },
      false,
    ).flatMap((element) => {
      const template = layoutPlaceholderTemplate(element);
      return template ? [template] : [];
    });
    const editEnv = inheritance.envFor(layoutPath, true);
    return [{
      id: layoutPath,
      name: attr(walk(inheritance.layoutRoot, 'cSld'), 'name') ?? layoutPath,
      origin: { part: layoutPath, masterPart: inheritance.masterPath },
      themeId: themeByMaster[inheritance.masterPath],
      background: resolvedSlideBackground(null, null, inheritance),
      ...(walk(inheritance.layoutRoot, 'cSld', 'bg') ? { directBackground: true as const } : {}),
      showMasterShapes: boolAttr(inheritance.layoutRoot, 'showMasterSp', true),
      elements: [...staticElements, ...placeholders],
      transition: parseTransition(inheritance.layoutRoot) ?? undefined,
      defaultShape: defaultShapeEditInfo(editEnv)!,
      defaultTable: defaultTableEditInfo(editEnv, TABLE_FORMAT_READER),
      tableStyles: tableStyleCatalog(tableStyles, editEnv, TABLE_FORMAT_READER),
    }];
  });
}

export function parseSlide(
  pkg: Pkg,
  slidePath: string,
  slideNum: number,
  presRoot: Element,
  tableStyles: Element | null,
  slideIdMap: Record<string, number>,
  authors: Map<string, AuthorInfo>,
  edit: boolean,
  layoutOverride?: string,
  docDefaults?: SharedDocDefaults,
): Slide {
  const slideRoot = pkg.xml(slidePath);
  const slideRels = pkg.rels(slidePath);
  const layoutPath = layoutOverride ?? relByType(slideRels, '/slideLayout');
  const inheritance = slideInheritance(
    pkg, slideRoot, layoutPath, presRoot, tableStyles, slideIdMap, slideNum, edit, docDefaults,
  );
  const { layoutRoot, masterPath, masterTree, layoutTree, envFor } = inheritance;
  const slideTree = walk(slideRoot, 'cSld', 'spTree');

  const elements: SlideElement[] = [];
  const showMaster = boolAttr(slideRoot, 'showMasterSp', true) && boolAttr(layoutRoot, 'showMasterSp', true);
  if (showMaster && masterPath) {
    elements.push(...parseShapeTree(masterTree, envFor(masterPath, false), true));
  }
  elements.push(...parseShapeTree(layoutTree, envFor(layoutPath, false), true));
  elements.push(...parseShapeTree(slideTree, envFor(slidePath, true), false));

  const background = resolvedSlideBackground(slideRoot, slidePath, inheritance);

  // 运动路径的坐标是幻灯片尺寸的比例，解析时就得换算成 px
  const sz = kid(presRoot, 'sldSz');
  const slideW = emu(numAttr(sz, 'cx') ?? 12192000);
  const slideH = emu(numAttr(sz, 'cy') ?? 6858000);

  const notesRelationship = Object.entries(slideRels)
    .find(([, relationship]) => relationship.type.endsWith('/notesSlide'));
  const notesPath = notesRelationship?.[1].target ?? null;
  const notes = notesPath ? extractNotesText(pkg.xml(notesPath)) : '';
  const comments = parseSlideComments(pkg, slideRels, authors);
  const directTransition = parseTransition(slideRoot);
  const timing = parseSlideTiming(slideRoot, slideW, slideH);
  // timing 树媒体节点的播放语义按 spid 回填到媒体元素；解析不到目标（如引用母版形状）时丢弃
  for (const mediaTiming of timing.media ?? []) {
    const target = elements.find(el => el.kind === 'image' && el.media?.spid === mediaTiming.spid);
    if (target && target.kind === 'image' && target.media) target.media.playback = {
      volume: mediaTiming.volume, loop: mediaTiming.loop, clickGroup: mediaTiming.clickGroup,
    };
  }
  const editEnv = edit ? envFor(slidePath, true) : null;

  return {
    background,
    elements,
    notes: notes || undefined,
    comments: comments.length ? comments : undefined,
    hidden: attr(slideRoot, 'show') === '0' || undefined,
    layoutName: attr(walk(layoutRoot, 'cSld'), 'name') ?? undefined,
    transition: directTransition ?? parseTransition(layoutRoot),
    animations: timing.animations,
    ...(edit ? {
      editInfo: {
        origin: { part: slidePath }, ...(layoutPath ? { layoutId: layoutPath } : {}),
        ...(notesPath && notesRelationship
          ? { notes: { part: notesPath, relationshipId: notesRelationship[0] } } : {}),
        ...(walk(slideRoot, 'cSld', 'bg') ? { directBackground: true as const } : {}),
        ...(directTransition ? { directTransition: true as const } : {}),
        ...(timing.readonly ? { animationSourceReadonly: true as const } : {}),
        ...(!boolAttr(slideRoot, 'showMasterSp', true) ? { hideMasterShapes: true as const } : {}),
        defaultShape: defaultShapeEditInfo(editEnv!),
        defaultTable: defaultTableEditInfo(editEnv!, TABLE_FORMAT_READER),
        tableStyles: tableStyleCatalog(tableStyles, editEnv!, TABLE_FORMAT_READER),
      },
    } : {}),
  };
}
