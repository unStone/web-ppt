/**
 * DrawingML 几何的 OOXML 读取层：avLst 调节值与 custGeom 自定义路径。
 * 纯计算部分（预设形状表 / presetGeom）在 ../geometry，格式无关。
 */
import { attr, kid, kids, numAttr } from '../xml';
import { ep, n, rad } from '../geometry';
import type { Adj, Geom, Pt } from '../geometry';
import {
  builtinGuideValues, DRAWINGML_DEGREE, evaluateGuideDefinitions, guideToken,
} from '../geometry/guides';
import type { GuideDefinition } from '../geometry/guides';
import type {
  CustomGeometry, CustomGeometryCommand, CustomGeometryGuide, CustomGeometryPoint,
  CustomGeometryPointRole, CustomGeometryScalar,
} from '../geometry/custom';

export { isKnownPreset, presetGeom, resolveGeomPath } from '../geometry';
export type { Adj, Geom, GeomSpec, Pt } from '../geometry';

/** avLst → 调节值表（保留 100000 制原值） */
export function parseAdjustments(avLst: Element | null): Adj {
  const out: Adj = {};
  for (const gd of kids(avLst, 'gd')) {
    const name = attr(gd, 'name');
    const fmla = attr(gd, 'fmla');
    if (name && fmla?.startsWith('val ')) {
      const v = Number(fmla.slice(4));
      if (Number.isFinite(v)) out[name] = v;
    }
  }
  return out;
}

// ---------------- custGeom + guide 公式求值 ----------------

function geometryGuideDefinitions(list: Element | null): GuideDefinition[] {
  return kids(list, 'gd').flatMap((guide) => {
    const name = attr(guide, 'name');
    const formula = attr(guide, 'fmla');
    return name && formula ? [[name, formula] as const] : [];
  });
}

const geometryGuides = (definitions: readonly GuideDefinition[]): CustomGeometryGuide[] =>
  definitions.map(([name, formula]) => ({ name, formula }));

/** edit 模式专用：表达式原样保留，交互使用同一 guide 求值后的数值。 */
export function customGeometryModel(custGeom: Element, w: number, h: number): CustomGeometry {
  const adjustmentDefinitions = geometryGuideDefinitions(kid(custGeom, 'avLst'));
  const guideDefinitions = geometryGuideDefinitions(kid(custGeom, 'gdLst'));
  const adjustments = geometryGuides(adjustmentDefinitions);
  const guides = geometryGuides(guideDefinitions);
  const paths = kids(kid(custGeom, 'pathLst'), 'path').map((path, pathIndex) => {
    const width = numAttr(path, 'w') || w * 9525;
    const height = numAttr(path, 'h') || h * 9525;
    const values = builtinGuideValues(width, height);
    evaluateGuideDefinitions(adjustmentDefinitions, values);
    evaluateGuideDefinitions(guideDefinitions, values);
    const scalar = (expression: string | null): CustomGeometryScalar => {
      const source = expression ?? '0';
      const parsed = source in values ? values[source] : Number(source);
      return { expression: source, value: Number.isFinite(parsed) ? parsed : 0 };
    };
    const point = (
      element: Element | undefined, id: string, role: CustomGeometryPointRole,
    ): CustomGeometryPoint => ({
      id, role,
      x: scalar(attr(element ?? null, 'x')),
      y: scalar(attr(element ?? null, 'y')),
    });
    const commands: CustomGeometryCommand[] = [];
    let closed = false;
    const elements: Element[] = [];
    for (let element = path.firstElementChild; element; element = element.nextElementSibling) {
      if (['moveTo', 'lnTo', 'cubicBezTo', 'quadBezTo', 'arcTo', 'close'].includes(element.localName)) {
        elements.push(element);
      }
    }
    elements.forEach((element, elementIndex) => {
      const commandIndex = commands.length;
      const id = `p${pathIndex}-c${commandIndex}`;
      const commandPoints = kids(element, 'pt');
      if (element.localName === 'moveTo' || element.localName === 'lnTo') {
        const anchor = point(commandPoints[0], `${id}-a`, 'anchor');
        commands.push({
          id, type: element.localName === 'moveTo' ? 'move' : 'line',
          points: [anchor],
        });
      } else if (element.localName === 'cubicBezTo') {
        const points = [
          point(commandPoints[0], `${id}-c0`, 'control'),
          point(commandPoints[1], `${id}-c1`, 'control'),
          point(commandPoints[2], `${id}-a`, 'anchor'),
        ] as const;
        commands.push({
          id, type: 'cubic', points,
        });
      } else if (element.localName === 'quadBezTo') {
        const points = [
          point(commandPoints[0], `${id}-c0`, 'control'),
          point(commandPoints[1], `${id}-a`, 'anchor'),
        ] as const;
        commands.push({
          id, type: 'quadratic', points,
        });
      } else if (element.localName === 'arcTo') {
        commands.push({
          id, type: 'arc', points: [],
          widthRadius: scalar(attr(element, 'wR')),
          heightRadius: scalar(attr(element, 'hR')),
          startAngle: scalar(attr(element, 'stAng')),
          sweepAngle: scalar(attr(element, 'swAng')),
        });
      } else if (element.localName === 'close') {
        if (elementIndex === elements.length - 1) closed = true;
        else commands.push({ id, type: 'close', points: [] });
      }
    });
    return {
      id: `p${pathIndex}`, width, height,
      fill: attr(path, 'fill') ?? 'norm',
      stroke: !['0', 'false'].includes(attr(path, 'stroke') ?? '1'),
      extrusionOk: !['0', 'false'].includes(attr(path, 'extrusionOk') ?? '1'),
      closed, commands,
    };
  });
  return { adjustments, guides, paths };
}

/** custGeom → SVG path，支持 gdLst 公式与 guide 引用 */
export function custGeomPath(custGeom: Element, w: number, h: number): Geom | null {
  const paths = kids(kid(custGeom, 'pathLst'), 'path');
  if (!paths.length) return null;
  const adjustmentDefinitions = geometryGuideDefinitions(kid(custGeom, 'avLst'));
  const guideDefinitions = geometryGuideDefinitions(kid(custGeom, 'gdLst'));

  const out: string[] = [];
  let anyFill = false;
  let anyStroke = false;

  for (const p of paths) {
    const pw = numAttr(p, 'w') || 0;
    const ph = numAttr(p, 'h') || 0;
    // 路径坐标空间：path 自带 w/h 时用它，否则用形状的 EMU 尺寸
    const spaceW = pw || w * 9525;
    const spaceH = ph || h * 9525;
    const g = builtinGuideValues(spaceW, spaceH);
    evaluateGuideDefinitions(adjustmentDefinitions, g);
    evaluateGuideDefinitions(guideDefinitions, g);

    const sx = spaceW ? w / spaceW : 1;
    const sy = spaceH ? h / spaceH : 1;

    const num = (v: string | null): number => guideToken(v, g);
    const ptOf = (el: Element | null): Pt => [num(attr(el, 'x')) * sx, num(attr(el, 'y')) * sy];

    if ((attr(p, 'fill') ?? 'norm') !== 'none') anyFill = true;
    const st = attr(p, 'stroke');
    if (st !== '0' && st !== 'false') anyStroke = true;

    let cx = 0, cy = 0, startX = 0, startY = 0;
    for (let cmd = p.firstElementChild; cmd; cmd = cmd.nextElementSibling) {
      const pts = kids(cmd, 'pt');
      switch (cmd.localName) {
        case 'moveTo':
          [cx, cy] = ptOf(pts[0]);
          [startX, startY] = [cx, cy];
          out.push(`M ${n(cx)} ${n(cy)}`);
          break;
        case 'lnTo':
          [cx, cy] = ptOf(pts[0]);
          out.push(`L ${n(cx)} ${n(cy)}`);
          break;
        case 'cubicBezTo': {
          const [x1, y1] = ptOf(pts[0]);
          const [x2, y2] = ptOf(pts[1]);
          [cx, cy] = ptOf(pts[2]);
          out.push(`C ${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)} ${n(cx)} ${n(cy)}`);
          break;
        }
        case 'quadBezTo': {
          const [x1, y1] = ptOf(pts[0]);
          [cx, cy] = ptOf(pts[1]);
          out.push(`Q ${n(x1)} ${n(y1)} ${n(cx)} ${n(cy)}`);
          break;
        }
        case 'arcTo': {
          const wr = num(attr(cmd, 'wR')) * sx;
          const hr = num(attr(cmd, 'hR')) * sy;
          const stAng = num(attr(cmd, 'stAng')) / DRAWINGML_DEGREE;
          const swAng = num(attr(cmd, 'swAng')) / DRAWINGML_DEGREE;
          const ccx = cx - wr * Math.cos(rad(stAng));
          const ccy = cy - hr * Math.sin(rad(stAng));
          const steps = Math.max(1, Math.ceil(Math.abs(swAng) / 180));
          for (let i = 0; i < steps; i++) {
            const seg = swAng / steps;
            const [ex, ey] = ep(ccx, ccy, wr, hr, stAng + seg * (i + 1));
            out.push(`A ${n(wr)} ${n(hr)} 0 ${Math.abs(seg) > 180 ? 1 : 0} ${seg >= 0 ? 1 : 0} ${n(ex)} ${n(ey)}`);
            cx = ex;
            cy = ey;
          }
          break;
        }
        case 'close':
          out.push('Z');
          [cx, cy] = [startX, startY];
          break;
      }
    }
  }

  const d = out.join(' ');
  if (!d.trim()) return null;
  return { d, open: !anyFill && anyStroke };
}
