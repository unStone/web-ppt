/**
 * 形状树：sp / cxnSp / pic / grpSp / contentPart / mc:AlternateContent → 统一 Schema 元素。
 * graphicFrame（表格 / 图表 / SmartArt / OLE）见 graphic-frame.ts，共用属性见 shape-props.ts。
 */
import { inkStrokes } from '../ink/render';
import { PLACEHOLDER_TYPE_EQUIVALENTS } from '../placeholder-match';
import type {
  ElementBase,
  GroupElement,
  ImageElement,
  MediaInfo,
  ShapeElement,
  SlideElement,
  TextBody,
  UnsupportedElement,
} from '../types';
import { attr, kid, numAttr, walk } from '../xml';
import { parseColor } from './color';
import { parse3D, parseEffects } from './effects';
import { custGeomPath, customGeometryModel, parseAdjustments, presetGeom } from './geometry';
import { extractLstStyle, parseTextBody, TextEnv } from './text';
import type { LevelStyles } from './text';
import { completeTextTemplateLevels } from './text-template';
import { hyperlinkOf, resolveLink } from './hyperlink';
import { Env, findPh } from './slide-inheritance';
import { parseCompatibleShapes } from './shape-compatibility';
import { retainCompatibilitySource } from './compatibility-source';
import {
  base,
  blipFilter,
  blipUrl,
  editInfoOf,
  movementLocked,
  parseFillProps,
  parseLnElement,
  parseXfrm,
  placeholderDirectBits,
  resolveStyleRefs,
  styleTextColorLayer,
} from './shape-props';
import { parseGraphicFrame } from './graphic-frame';

/** 音视频容器 → MIME；未知扩展名按媒体类型给个兜底值 */
const MEDIA_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ogv: 'video/ogg',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  wma: 'audio/x-ms-wma',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  aac: 'audio/aac',
  mid: 'audio/midi',
  midi: 'audio/midi',
};

// ---------------- 形状树 ----------------

export function parseShapeTree(tree: Element | null, env: Env, skipPh: boolean): SlideElement[] {
  const out: SlideElement[] = [];
  if (!tree) return out;
  for (let node = tree.firstElementChild; node; node = node.nextElementSibling) {
    let el: SlideElement | SlideElement[] | null = null;
    // 单个形状解析失败不应连累整页——真实文件里常见某个可选节点缺失/畸形，
    // 一路抛到顶层会让整张幻灯片变成错误占位。
    try {
      el = parseOneShape(node, env, skipPh);
    } catch (err) {
      el = brokenShapePlaceholder(node, err, env);
    }
    if (Array.isArray(el)) out.push(...el);
    else if (el) out.push(el);
  }
  return out;
}

/** 解析形状树里的单个节点 */
function parseOneShape(node: Element, env: Env, skipPh: boolean): SlideElement | SlideElement[] | null {
  {
    let el: SlideElement | SlideElement[] | null = null;
    switch (node.localName) {
      case 'sp':
      case 'cxnSp': {
        const nv = node.localName === 'sp' ? 'nvSpPr' : 'nvCxnSpPr';
        const ph = walk(node, nv, 'nvPr', 'ph');
        if (skipPh && ph) break;
        if (ph && env.hiddenPh.has(attr(ph, 'type') ?? '')) break;
        el = parseSp(node, env);
        break;
      }
      case 'pic':
        el = parsePic(node, env);
        break;
      case 'grpSp':
        el = parseGroup(node, env, skipPh);
        break;
      case 'graphicFrame':
        el = parseGraphicFrame(node, env);
        break;
      case 'contentPart':
        el = parseContentPart(node, env);
        break;
      case 'AlternateContent': {
        if (env.edit) retainCompatibilitySource(env.pkg, node, env.partPath);
        return parseCompatibleShapes(
          node,
          (branch) => parseShapeTree(branch, env, skipPh),
          (source) => brokenShapePlaceholder(source, '不支持的兼容内容', env),
          env.edit,
          env.pkg,
        );
      }
    }
    return el;
  }
}

/** 解析失败时给一个可见但不打断阅读的占位，方便定位问题而不是整页丢失 */
function brokenShapePlaceholder(node: Element, err: unknown, env: Env): UnsupportedElement | null {
  const nv =
    kid(node, 'nvSpPr')
    ?? kid(node, 'nvPicPr')
    ?? kid(node, 'nvGrpSpPr')
    ?? kid(node, 'nvCxnSpPr')
    ?? kid(node, 'nvGraphicFramePr')
    ?? kid(node, 'nvContentPartPr');
  const xf = parseXfrm(walk(node, 'spPr', 'xfrm') ?? walk(node, 'grpSpPr', 'xfrm') ?? kid(node, 'xfrm'));
  if (!xf || xf.w <= 0 || xf.h <= 0) return null;
  const cNvPr = kid(nv, 'cNvPr');
  const name = attr(cNvPr, 'name') ?? node.localName;
  const reason = err instanceof Error ? err.message : String(err);
  return {
    kind: 'unsupported',
    ...base(xf),
    id: numAttr(cNvPr, 'id') ?? undefined,
    label: `${name}（解析失败：${reason.slice(0, 40)}）`,
    ...editInfoOf(env, cNvPr, walk(nv, 'nvPr', 'ph'), undefined, 'frame', movementLocked(nv)),
  };
}

function parseSp(sp: Element, env: Env): ShapeElement | null {
  const nvName = sp.localName === 'cxnSp' ? 'nvCxnSpPr' : 'nvSpPr';
  const nv = kid(sp, nvName);
  const cNvPr = kid(nv, 'cNvPr');
  const ph = walk(nv, 'nvPr', 'ph');
  const phType = attr(ph, 'type');
  const phIdx = attr(ph, 'idx');
  const spPr = kid(sp, 'spPr');

  const layoutSp = ph ? findPh(env.layoutPh, phType, phIdx) : null;
  const masterSp = ph ? findPh(env.masterPh, phType, phIdx) : null;

  let xf = parseXfrm(kid(spPr, 'xfrm'));
  if (!xf && ph) xf = parseXfrm(walk(layoutSp, 'spPr', 'xfrm')) ?? parseXfrm(walk(masterSp, 'spPr', 'xfrm'));
  if (!xf) return null;

  const styleRef = resolveStyleRefs(kid(sp, 'style'), env);

  // 几何：自身 → 占位符继承
  let geomHost = spPr;
  if (!kid(spPr, 'prstGeom') && !kid(spPr, 'custGeom') && ph) {
    geomHost = walk(layoutSp, 'spPr') ?? walk(masterSp, 'spPr') ?? spPr;
  }
  const prstGeom = kid(geomHost, 'prstGeom');
  const custGeom = kid(geomHost, 'custGeom');
  let path: string | null = null;
  let openGeom = false;
  let editableGeom: NonNullable<ElementBase['editInfo']>['geom'] | undefined;
  let editableCustomGeometry: NonNullable<ElementBase['editInfo']>['customGeometry'] | undefined;
  if (prstGeom) {
    const preset = attr(prstGeom, 'prst') ?? 'rect';
    const adj = parseAdjustments(kid(prstGeom, 'avLst'));
    const g = presetGeom(preset, xf.w, xf.h, adj);
    path = g.d;
    openGeom = g.open;
    if (env.edit) editableGeom = { preset, adj };
  } else if (custGeom) {
    const g = custGeomPath(custGeom, xf.w, xf.h);
    if (g) {
      path = g.d;
      openGeom = g.open;
    }
    if (env.edit) editableCustomGeometry = customGeometryModel(custGeom, xf.w, xf.h);
  }

  let fill = parseFillProps(spPr, env);
  if (!fill && ph) fill = parseFillProps(walk(layoutSp, 'spPr'), env) ?? parseFillProps(walk(masterSp, 'spPr'), env);
  if (!fill) fill = styleRef.fill;
  if (openGeom) fill = { type: 'none' };

  let stroke = parseLnElement(kid(spPr, 'ln'), env, styleRef.stroke);
  if (!kid(spPr, 'ln') && ph) {
    stroke = parseLnElement(walk(layoutSp, 'spPr', 'ln') ?? walk(masterSp, 'spPr', 'ln'), env, stroke);
  }

  const effects = parseEffects(kid(spPr, 'effectLst'), env.ctx) ?? styleRef.effects;
  // Presentation 的既有字段不改语义；编辑模式另存解绑旧版式时才需要的继承来源。
  const placeholderInheritedEffects =
    env.edit && !effects && ph && !kid(sp, 'style')
      ? (parseEffects(walk(layoutSp, 'spPr', 'effectLst') ?? walk(masterSp, 'spPr', 'effectLst'), env.ctx) ?? undefined)
      : undefined;

  // 无几何但有填充/描边时按矩形处理（常见于省略 prstGeom 的文本框）
  if (!path && (fill || stroke)) path = presetGeom('rect', xf.w, xf.h, {}).d;

  const txBody = kid(sp, 'txBody');
  let text: TextBody | null = null;
  let textTemplate: TextBody | undefined;
  let textLevelTemplate: TextBody | undefined;
  if (txBody) {
    const chain: LevelStyles[] = [env.docDefaults];
    if (ph) {
      const cat =
        phType === 'title' || phType === 'ctrTitle'
          ? 'title'
          : !phType || PLACEHOLDER_TYPE_EQUIVALENTS.body.includes(phType)
            ? 'body'
            : 'other';
      chain.push(env.masterStyles[cat]);
      chain.push(extractLstStyle(walk(masterSp, 'txBody', 'lstStyle'), env.ctx, env.theme.fonts));
      chain.push(extractLstStyle(walk(layoutSp, 'txBody', 'lstStyle'), env.ctx, env.theme.fonts));
    } else {
      chain.push(...styleTextColorLayer(styleRef.fontColor));
    }
    chain.push(extractLstStyle(kid(txBody, 'lstStyle'), env.ctx, env.theme.fonts));
    const textEnv: TextEnv = {
      ctx: env.ctx,
      fonts: env.theme.fonts,
      chain,
      defaultColor: styleRef.fontColor,
      slideNum: env.slideNum,
      bodyPrFallbacks: [walk(layoutSp, 'txBody', 'bodyPr'), walk(masterSp, 'txBody', 'bodyPr')],
      resolveLink: (rid, action) => resolveLink(env, rid, action),
      resolveImage: (rid) => {
        const t = env.rels[rid]?.target;
        return t ? env.pkg.mediaUrl(t) : null;
      },
      edit: env.edit,
    };
    text = parseTextBody(txBody, textEnv);
    if (!text && env.edit) {
      textTemplate = parseTextBody(txBody, textEnv, true) ?? undefined;
    }
    const levelSeed = text ?? textTemplate;
    if (env.edit && levelSeed) {
      const completed = completeTextTemplateLevels(levelSeed, textEnv, env.layoutCatalog === true);
      const key = JSON.stringify(completed);
      textLevelTemplate = env.textLevelTemplateCache?.get(key) ?? completed;
      env.textLevelTemplateCache?.set(key, textLevelTemplate);
    }
  }

  if (!path && !text && !textTemplate) return null;
  const hyperlink = hyperlinkOf(cNvPr, env);
  const editing = editInfoOf(
    env,
    cNvPr,
    ph,
    editableGeom,
    undefined,
    movementLocked(nv),
    hyperlink.unsupported,
    placeholderDirectBits(spPr, kid(sp, 'style')),
    editableCustomGeometry,
  );
  if (editing.editInfo && textTemplate) editing.editInfo.textTemplate = textTemplate;
  if (editing.editInfo && textLevelTemplate) editing.editInfo.textLevelTemplate = textLevelTemplate;
  if (editing.editInfo && placeholderInheritedEffects) {
    editing.editInfo.placeholderInheritedEffects = placeholderInheritedEffects;
  }
  return {
    kind: 'shape',
    ...base(xf),
    path,
    fill,
    stroke,
    text,
    openGeom: openGeom || undefined,
    effects,
    scene3d: parse3D(spPr, env.ctx),
    link: hyperlink.link,
    name: attr(cNvPr, 'name') ?? undefined,
    id: numAttr(cNvPr, 'id') ?? undefined,
    ...editing,
  };
}

// ---------------- 媒体（音频 / 视频） ----------------

const VIDEO_TAGS = new Set(['videoFile', 'quickTimeFile']);
const AUDIO_TAGS = new Set(['audioFile', 'wavAudioFile', 'audioCd']);

const isExternalTarget = (t: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(t);

/**
 * 在 p:nvPr（含 extLst 里的 p14:media）中找音视频引用。
 *
 * 经典元素（ISO 29500 a:audioFile / a:videoFile 的 r:link）是标准引用，先试；
 * p14:media（MS-PPTX 2.3.3.14）是 PowerPoint 2010+ 的媒体扩展，二者并存时自身按 r:link 优先于 r:embed。
 * 新版 PowerPoint 内嵌 2007 不支持的容器（mp3 / mp4 等）时把经典关系写成 Target="NULL" TargetMode="External"，
 * 真实字节只在 p14:media 的 r:embed 部件里——所以逐个候选取第一个能解析的：
 * 包内关系要求部件真实存在，外链关系要求是带 scheme 的 URL。
 */
function parseMedia(nvPr: Element | null, env: Env): MediaInfo | undefined {
  if (!nvPr) return undefined;
  let audio: Element | null = null;
  let video: Element | null = null;
  let extension: Element | null = null;
  const all = nvPr.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const ln = all[i].localName;
    if (!audio && AUDIO_TAGS.has(ln)) audio = all[i];
    else if (!video && VIDEO_TAGS.has(ln)) video = all[i];
    else if (!extension && ln === 'media') extension = all[i];
  }
  // p14:media 不区分音视频；有经典音频元素时以它为准
  const kind: MediaInfo['kind'] | null = audio ? 'audio' : video || extension ? 'video' : null;
  if (!kind) return undefined;

  const candidates = [audio ?? video, extension].flatMap((node) => (node ? [attr(node, 'r:link'), attr(node, 'r:embed')] : []));
  for (const rid of candidates) {
    const rel = rid ? env.rels[rid] : undefined;
    if (!rel) continue;
    if (rel.external) {
      if (isExternalTarget(rel.target)) return { kind, src: rel.target, external: true };
      continue;
    }
    const ext = rel.target.slice(rel.target.lastIndexOf('.') + 1).toLowerCase();
    const mime = MEDIA_MIME[ext] ?? (kind === 'audio' ? 'audio/mpeg' : 'video/mp4');
    const src = env.pkg.blobUrl(rel.target, mime);
    if (src) return { kind, src, mime };
  }
  return { kind, src: null };
}

export function parsePic(pic: Element, env: Env): ImageElement | UnsupportedElement | null {
  const nv = kid(pic, 'nvPicPr');
  const spPr = kid(pic, 'spPr');
  // 内容占位符里放的图片常常是空 <p:spPr/>，位置尺寸全靠版式/母版继承。
  // 不做这一步整张图会被丢掉——真实文件里这种写法很常见。
  const ph = walk(nv, 'nvPr', 'ph');
  let xf = parseXfrm(kid(spPr, 'xfrm'));
  if (!xf && ph) {
    const phType = attr(ph, 'type');
    const phIdx = attr(ph, 'idx');
    xf =
      parseXfrm(walk(findPh(env.layoutPh, phType, phIdx), 'spPr', 'xfrm'))
      ?? parseXfrm(walk(findPh(env.masterPh, phType, phIdx), 'spPr', 'xfrm'));
  }
  if (!xf) return null;
  const cNvPr = kid(nv, 'cNvPr');
  const blipFill = kid(pic, 'blipFill');
  const src = blipUrl(blipFill, env);
  const label = attr(cNvPr, 'name') ?? '图片';
  const media = parseMedia(kid(nv, 'nvPr'), env);
  if (media) media.spid = numAttr(cNvPr, 'id') ?? undefined;
  const hyperlink = hyperlinkOf(cNvPr, env);
  // 媒体对象即使没有封面帧也要出现（渲染层画深色底 + 播放标识）
  if (!src && !media) {
    return {
      kind: 'unsupported',
      ...base(xf),
      label: `${label}（格式不支持）`,
      link: hyperlink.link,
      name: attr(cNvPr, 'name') ?? undefined,
      id: numAttr(cNvPr, 'id') ?? undefined,
      ...editInfoOf(env, cNvPr, ph, undefined, 'frame', movementLocked(nv), hyperlink.unsupported),
    };
  }

  const srcRect = kid(blipFill, 'srcRect');
  const frac = (name: string): number => (numAttr(srcRect, name) ?? 0) / 100000;
  const crop = srcRect ? { l: frac('l'), t: frac('t'), r: frac('r'), b: frac('b') } : null;

  // 非矩形轮廓 → 裁剪路径。默认预览仍只看图片自己的 spPr；编辑态另外记录继承语义。
  let clipPath: string | null = null;
  const prstGeom = kid(spPr, 'prstGeom');
  const custGeom = kid(spPr, 'custGeom');
  let editableGeom: NonNullable<ElementBase['editInfo']>['geom'] | undefined;
  if (prstGeom) {
    const preset = attr(prstGeom, 'prst') ?? 'rect';
    const adj = parseAdjustments(kid(prstGeom, 'avLst'));
    if (preset !== 'rect') clipPath = presetGeom(preset, xf.w, xf.h, adj).d;
    if (env.edit) editableGeom = { preset, adj };
  } else if (custGeom) {
    clipPath = custGeomPath(custGeom, xf.w, xf.h)?.d ?? null;
  } else if (env.edit && ph) {
    const phType = attr(ph, 'type');
    const phIdx = attr(ph, 'idx');
    const inherited =
      walk(findPh(env.layoutPh, phType, phIdx), 'spPr', 'prstGeom') ?? walk(findPh(env.masterPh, phType, phIdx), 'spPr', 'prstGeom');
    if (inherited) {
      editableGeom = {
        preset: attr(inherited, 'prst') ?? 'rect',
        adj: parseAdjustments(kid(inherited, 'avLst')),
      };
    }
  }

  const alphaMod = numAttr(kid(kid(blipFill, 'blip'), 'alphaModFix'), 'amt');
  const tones = Array.from(kid(kid(blipFill, 'blip'), 'duotone')?.children ?? []).map((color) => parseColor(color, env.ctx));

  return {
    kind: 'image',
    ...base(xf),
    src: src ?? '',
    crop,
    clipPath,
    alpha: alphaMod !== null ? alphaMod / 100000 : undefined,
    filter: blipFilter(blipFill),
    ...(tones.length === 2 ? { duotone: tones as [string, string] } : {}),
    stroke: parseLnElement(kid(spPr, 'ln'), env, null),
    effects: parseEffects(kid(spPr, 'effectLst'), env.ctx),
    link: hyperlink.link,
    name: attr(cNvPr, 'name') ?? undefined,
    id: numAttr(cNvPr, 'id') ?? undefined,
    media,
    ...editInfoOf(
      env,
      cNvPr,
      ph,
      editableGeom,
      media ? 'frame' : undefined,
      movementLocked(nv),
      hyperlink.unsupported,
      placeholderDirectBits(spPr, null),
    ),
  };
}

// ---------------- 墨迹批注（p14:contentPart + InkML） ----------------

/** <p14:contentPart>：墨迹批注，r:id 指向 InkML part */
function parseContentPart(node: Element, env: Env): GroupElement | null {
  const xf = parseXfrm(kid(node, 'xfrm'));
  if (!xf || xf.w <= 0 || xf.h <= 0) return null;
  const rid = attr(node, 'r:id');
  const target = rid ? env.rels[rid]?.target : null;
  const root = target ? env.pkg.xml(target) : null;
  // 数据缺失不是有意留空的 Choice；交给形状级诊断才能继续尝试兼容图片。
  if (!root) throw new Error('缺少 InkML 内容');
  const children = inkStrokes(root, xf.w, xf.h);
  if (!children.length) throw new Error('InkML 没有可用笔迹');
  const cNvPr = walk(node, 'nvContentPartPr', 'cNvPr');
  const edit = editInfoOf(env, cNvPr, null, undefined, 'frame');
  if (env.edit) {
    retainCompatibilitySource(env.pkg, node, env.partPath);
    edit.editInfo = { ...edit.editInfo, requiresOriginal: true };
  }
  return {
    kind: 'group',
    ...base(xf),
    childX: 0,
    childY: 0,
    scaleX: 1,
    scaleY: 1,
    children,
    name: attr(cNvPr, 'name') ?? '墨迹',
    id: numAttr(cNvPr, 'id') ?? undefined,
    ...edit,
  };
}

function parseGroup(grp: Element, env: Env, skipPh: boolean): GroupElement | null {
  const nv = kid(grp, 'nvGrpSpPr');
  const grpSpPr = kid(grp, 'grpSpPr');
  const xf = parseXfrm(kid(grpSpPr, 'xfrm'));
  if (!xf) return null;
  const children = parseShapeTree(grp, env, skipPh);
  if (!children.length) return null;
  const cNvPr = kid(nv, 'cNvPr');
  const hyperlink = hyperlinkOf(cNvPr, env);
  return {
    kind: 'group',
    ...base(xf),
    childX: xf.chX,
    childY: xf.chY,
    scaleX: xf.chW ? xf.w / xf.chW : 1,
    scaleY: xf.chH ? xf.h / xf.chH : 1,
    children,
    effects: parseEffects(kid(grpSpPr, 'effectLst'), env.ctx),
    link: hyperlink.link,
    name: attr(cNvPr, 'name') ?? undefined,
    id: numAttr(cNvPr, 'id') ?? undefined,
    ...editInfoOf(env, cNvPr, null, undefined, undefined, movementLocked(nv), hyperlink.unsupported),
  };
}
