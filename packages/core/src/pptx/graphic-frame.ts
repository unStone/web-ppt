/**
 * graphicFrame 分派：表格、经典 / 扩展图表、SmartArt、OLE 预览与其余不支持的对象。
 */
import type { GroupElement, SlideElement } from '../types';
import { attr, kid, numAttr, walk } from '../xml';
import { getChartParser } from '../chart/hook';
import { parseTextBody, TextEnv } from './text';
import { buildDiagram, isVertical, layoutFamily, parseDataModel, parseDiagramColors, pointTxBody, wrapDiagram } from './diagram';
import { engineShapesToElements, evaluateLayoutDef } from '../diagram-engine';
import { Env, relByType } from './slide-inheritance';
import { parseTable } from './table-style';
import { retainCompatibilitySource } from './compatibility-source';
import { TABLE_FORMAT_READER, XfrmInfo, base, editInfoOf, movementLocked, parseXfrm } from './shape-props';
import { parsePic, parseShapeTree } from './shapes';

export function parseGraphicFrame(frame: Element, env: Env): SlideElement | SlideElement[] | null {
  const nv = kid(frame, 'nvGraphicFramePr');
  const xf = parseXfrm(kid(frame, 'xfrm'));
  if (!xf) return null;
  const data = walk(frame, 'graphic', 'graphicData');
  const uri = attr(data, 'uri') ?? '';
  const frameCNvPr = kid(nv, 'cNvPr');
  const framePh = walk(nv, 'nvPr', 'ph');
  const name = attr(frameCNvPr, 'name') ?? undefined;
  const frameId = numAttr(frameCNvPr, 'id') ?? undefined;
  const frameEditInfo = editInfoOf(env, frameCNvPr, framePh, undefined, undefined, movementLocked(nv));
  const frameOnlyEditInfo = editInfoOf(env, frameCNvPr, framePh, undefined, 'frame', movementLocked(nv));

  const tbl = kid(data, 'tbl');
  if (tbl) {
    const parsed = parseTable(tbl, base(xf), env, TABLE_FORMAT_READER, name);
    const editInfo = env.edit ? { ...parsed.editInfo, ...frameEditInfo.editInfo } : undefined;
    return {
      ...parsed,
      id: frameId,
      ...frameEditInfo,
      ...(editInfo ? { editInfo } : {}),
    };
  }

  if (env.edit) {
    retainCompatibilitySource(env.pkg, frame, env.partPath);
    frameOnlyEditInfo.editInfo = { ...frameOnlyEditInfo.editInfo, requiresOriginal: true };
  }
  if (uri.endsWith('/chart') || uri === 'http://schemas.microsoft.com/office/drawing/2014/chartex') {
    const chart = parseChartFrame(data, xf, env, uri.endsWith('/chartex'));
    if (chart) return { ...chart, id: frameId, ...frameOnlyEditInfo };
    return { kind: 'unsupported', ...base(xf), label: '图表', name, id: frameId, ...frameOnlyEditInfo };
  }

  if (uri.endsWith('/diagram')) {
    const dgm = parseDiagram(data, xf, env);
    if (dgm) return { ...dgm, id: frameId, ...frameOnlyEditInfo };
    return { kind: 'unsupported', ...base(xf), label: 'SmartArt', name, id: frameId, ...frameOnlyEditInfo };
  }

  // graphicData 的 URI 是 .../presentationml/2006/ole，不含 oleObject —— 原先的
  // includes('oleObject') 从来没匹配上，OLE 一直落到「不支持的对象」分支
  if (uri.endsWith('/ole') || uri.includes('oleObject')) {
    const oleObj = kid(data, 'oleObj');
    if (oleObj) {
      // Office 2010+ 把预览图直接写成 p:oleObj 的 p:pic 子元素，
      // 走它能连裁剪 / 效果一起拿到；旧式的 VML 快照是后备路径
      const pic = kid(oleObj, 'pic');
      if (pic) {
        const img = parsePic(pic, env);
        // p:pic 自己的 xfrm 是相对 frame 的，位置以 frame 为准
        if (img && img.kind === 'image' && img.src) {
          return { ...img, ...base(xf), name: name ?? img.name, id: frameId, ...frameOnlyEditInfo };
        }
      }
      const src = olePreview(oleObj, env);
      if (src) return { kind: 'image', ...base(xf), src, crop: null, name, id: frameId, ...frameOnlyEditInfo };
    }
    return { kind: 'unsupported', ...base(xf), label: 'OLE 对象', name, id: frameId, ...frameOnlyEditInfo };
  }

  const label = uri.includes('/media') || uri.includes('video') ? '媒体对象' : '不支持的对象';
  return { kind: 'unsupported', ...base(xf), label, name, id: frameId, ...frameOnlyEditInfo };
}

/**
 * OLE 对象的预览图。
 *
 * PowerPoint 把嵌入对象的渲染快照放在旧式 VML 部件里：幻灯片的
 * vmlDrawing 关系 → <v:shape id="{oleObj@spid}"> → <v:imagedata o:relid>
 * → 该 VML 部件自己的关系 → 媒体文件。
 *
 * 预览格式随创作平台而变：Windows 通常是 EMF/WMF（我们能解），
 * Mac 版存的是 PICT（解不了）。mediaUrl 对认不出的扩展名返回 null，
 * 此时退回占位框而不是塞一张裂图。
 */
function olePreview(oleObj: Element, env: Env): string | null {
  const spid = attr(oleObj, 'spid');
  if (!spid) return null;
  const vmlPath = relByType(env.rels, '/vmlDrawing');
  if (!vmlPath) return null;
  // Pkg.rels 存的 target 已是包内绝对路径，不要再 resolvePath 一次
  const root = env.pkg.xml(vmlPath);
  if (!root) return null;

  for (const shape of root.getElementsByTagName('*')) {
    if (shape.localName !== 'shape' || attr(shape, 'id') !== spid) continue;
    for (const data of shape.getElementsByTagName('*')) {
      if (data.localName !== 'imagedata') continue;
      const rid = attr(data, 'o:relid') ?? attr(data, 'r:id');
      const target = rid ? env.pkg.rels(vmlPath)[rid]?.target : null;
      if (!target) return null;
      return env.pkg.mediaUrl(target);
    }
  }
  return null;
}

function parseChartFrame(data: Element | null, xf: XfrmInfo, env: Env, extended = false): GroupElement | null {
  if (!data) return null;
  const render = getChartParser(extended, env.pkg);
  const rid = attr(kid(data, 'chart'), 'r:id');
  const target = rid ? env.rels[rid]?.target : null;
  if (!render || !target) return null;
  const root = env.pkg.xml(target);
  if (!root) return null;
  let children: SlideElement[];
  try {
    children = render(root, xf.w, xf.h, {
      ctx: env.ctx,
      fonts: env.theme.fonts,
      rels: env.pkg.rels(target),
      ...(extended ? { readPart: (path: string) => env.pkg.files?.[path] } : {}),
    });
  } catch {
    return null;
  }
  if (!children.length) return null;
  return {
    kind: 'group',
    ...base(xf),
    childX: 0,
    childY: 0,
    scaleX: 1,
    scaleY: 1,
    children,
    name: '图表',
  };
}

/** SmartArt：读 dgm:relIds → 数据模型的 dataModelExt → 幻灯片 rels 中的 drawing part */
function parseDiagram(data: Element | null, xf: XfrmInfo, env: Env): GroupElement | null {
  if (!data) return null;
  const relIds = kid(data, 'relIds');
  let drawingPath: string | null = null;

  const dmRid = attr(relIds, 'r:dm');
  const dmTarget = dmRid ? env.rels[dmRid]?.target : null;
  if (dmTarget) {
    const dmRoot = env.pkg.xml(dmTarget);
    const ext = dmRoot?.getElementsByTagName('*');
    for (let i = 0; ext && i < ext.length; i++) {
      if (ext[i].localName === 'dataModelExt') {
        const relId = attr(ext[i], 'relId');
        if (relId && env.rels[relId]) drawingPath = env.rels[relId].target;
        break;
      }
    }
  }
  if (!drawingPath) drawingPath = relByType(env.rels, '/diagramDrawing');
  // 没有缓存的 drawing part（python-pptx / Google Slides 导出常见）时，
  // 退到自己按数据模型排布，总好过一个灰框
  if (!drawingPath) return layoutDiagram(relIds, xf, env);

  const root = env.pkg.xml(drawingPath);
  const tree = kid(root, 'spTree');
  if (!tree) return layoutDiagram(relIds, xf, env);

  const childEnv: Env = { ...env, rels: env.pkg.rels(drawingPath), partPath: drawingPath, layoutPh: [], masterPh: [] };
  const children = parseShapeTree(tree, childEnv, false);
  if (!children.length) return layoutDiagram(relIds, xf, env);

  // drawing 里的坐标是相对 frame 的绝对 EMU，用 group 的子坐标系归一
  return {
    kind: 'group',
    ...base(xf),
    childX: 0,
    childY: 0,
    scaleX: 1,
    scaleY: 1,
    children,
    name: 'SmartArt',
  };
}

/**
 * 按数据模型自行排布 SmartArt。见 diagram.ts 顶部对「做到哪一步」的说明。
 */
function layoutDiagram(relIds: Element | null, xf: XfrmInfo, env: Env): GroupElement | null {
  const partOf = (a: string): Element | null => {
    const rid = attr(relIds, a);
    const target = rid ? env.rels[rid]?.target : null;
    return target ? env.pkg.xml(target) : null;
  };
  const dataRoot = partOf('r:dm');
  const pts = parseDataModel(dataRoot);
  if (!pts.length) return null;

  const layoutRoot = partOf('r:lo');
  const colorsRoot = partOf('r:cs');

  // 配色：先用 colors part 里的，取不到退到主题强调色
  const raw = parseDiagramColors(colorsRoot);
  const colors = (raw.length ? raw : ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']).map((v: string) =>
    /^[0-9a-fA-F]{6}$/.test(v) ? `#${v}` : `#${env.ctx.theme[env.ctx.clrMap[v] ?? v] ?? '4472C4'}`,
  );

  const textEnv: TextEnv = {
    ctx: env.ctx,
    fonts: env.theme.fonts,
    chain: [env.docDefaults, env.masterStyles.other],
    defaultColor: 'rgb(255,255,255)',
    slideNum: env.slideNum,
  };

  // SmartArt 布局定义引擎（桌面 001）默认未接线：层级分支与 composite 完整
  // 约束代数交付前，默认路径保持启发式（引擎经 diagram-engine 显式供宿主使用）
  // 桌面 001：布局定义引擎优先；覆盖守恒等 reason 触发时回退启发式族布局
  const engine = evaluateLayoutDef(layoutRoot, pts, xf.w, xf.h);
  const children = engine.reason
    ? buildDiagram(pts, xf.w, xf.h, {
    family: layoutFamily(layoutRoot),
    vertical: isVertical(layoutRoot),
    colors,
    textOf: (id: string) => {
      const t = parseTextBody(pointTxBody(dataRoot, id), textEnv);
      // 数据模型里的文本没有 bodyPr，居中显示才像 SmartArt
      return t ? { ...t, anchor: 'middle', paragraphs: t.paragraphs.map((p) => ({ ...p, align: 'center' })) } : null;
    },
  })
    : engineShapesToElements(engine, pts, {
        colors,
        textOf: (id: string) => {
          const t = parseTextBody(pointTxBody(dataRoot, id), textEnv);
          return t ? { ...t, anchor: 'middle', paragraphs: t.paragraphs.map((p) => ({ ...p, align: 'center' })) } : null;
        },
      });
  if (!children.length) return null;
  return wrapDiagram(children, { ...base(xf), name: 'SmartArt' });
}
