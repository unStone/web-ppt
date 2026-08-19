/**
 * DrawingML 几何的 OOXML 读取层：avLst 调节值与 custGeom 自定义路径。
 * 纯计算部分（预设形状表 / presetGeom）在 ../geometry，格式无关。
 */
import { attr, kid, kids, numAttr } from '../xml';
import { ep, n, rad } from '../geometry';
import type { Adj, Geom, Pt } from '../geometry';

export { isKnownPreset, presetGeom } from '../geometry';
export type { Adj, Geom, Pt } from '../geometry';

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

const DEG = 60000;

function builtinGuides(w: number, h: number): Record<string, number> {
  const ss = Math.min(w, h);
  const g: Record<string, number> = {
    l: 0, t: 0, r: w, b: h, w, h, hc: w / 2, vc: h / 2,
    ls: Math.max(w, h), ss,
    cd2: 180 * DEG, cd4: 90 * DEG, cd8: 45 * DEG,
    '3cd4': 270 * DEG, '3cd8': 135 * DEG, '5cd8': 225 * DEG, '7cd8': 315 * DEG,
  };
  for (const d of [2, 3, 4, 5, 6, 8, 10, 32]) {
    g[`hd${d}`] = h / d;
    g[`wd${d}`] = w / d;
  }
  for (const d of [2, 4, 6, 8, 16, 32]) g[`ssd${d}`] = ss / d;
  return g;
}

function evalGuides(gdLst: Element | null, g: Record<string, number>): Record<string, number> {
  const val = (tok: string): number => {
    if (tok in g) return g[tok];
    const num = Number(tok);
    return Number.isFinite(num) ? num : 0;
  };
  for (const gd of kids(gdLst, 'gd')) {
    const name = attr(gd, 'name');
    const fmla = attr(gd, 'fmla');
    if (!name || !fmla) continue;
    const [op, ...args] = fmla.trim().split(/\s+/);
    const x = val(args[0] ?? '0'), y = val(args[1] ?? '0'), z = val(args[2] ?? '0');
    let r: number;
    switch (op) {
      case '*/': r = z === 0 ? 0 : (x * y) / z; break;
      case '+-': r = x + y - z; break;
      case '+/': r = z === 0 ? 0 : (x + y) / z; break;
      case '?:': r = x > 0 ? y : z; break;
      case 'abs': r = Math.abs(x); break;
      case 'at2': r = (Math.atan2(y, x) * 180 * DEG) / Math.PI; break;
      case 'cat2': r = x * Math.cos(Math.atan2(z, y)); break;
      case 'cos': r = x * Math.cos(rad(y / DEG)); break;
      case 'max': r = Math.max(x, y); break;
      case 'min': r = Math.min(x, y); break;
      case 'mod': r = Math.sqrt(x * x + y * y + z * z); break;
      case 'pin': r = y < x ? x : y > z ? z : y; break;
      case 'sat2': r = x * Math.sin(Math.atan2(z, y)); break;
      case 'sin': r = x * Math.sin(rad(y / DEG)); break;
      case 'sqrt': r = Math.sqrt(Math.max(x, 0)); break;
      case 'tan': r = x * Math.tan(rad(y / DEG)); break;
      case 'val': r = x; break;
      default: r = 0;
    }
    g[name] = Number.isFinite(r) ? r : 0;
  }
  return g;
}

/** custGeom → SVG path，支持 gdLst 公式与 guide 引用 */
export function custGeomPath(custGeom: Element, w: number, h: number): Geom | null {
  const paths = kids(kid(custGeom, 'pathLst'), 'path');
  if (!paths.length) return null;

  const out: string[] = [];
  let anyFill = false;
  let anyStroke = false;

  for (const p of paths) {
    const pw = numAttr(p, 'w') || 0;
    const ph = numAttr(p, 'h') || 0;
    // 路径坐标空间：path 自带 w/h 时用它，否则用形状的 EMU 尺寸
    const spaceW = pw || w * 9525;
    const spaceH = ph || h * 9525;
    const g = builtinGuides(spaceW, spaceH);
    evalGuides(kid(custGeom, 'avLst'), g);
    evalGuides(kid(custGeom, 'gdLst'), g);

    const sx = spaceW ? w / spaceW : 1;
    const sy = spaceH ? h / spaceH : 1;

    const num = (v: string | null): number => {
      if (v === null) return 0;
      if (v in g) return g[v];
      const parsed = Number(v);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const ptOf = (el: Element | null): Pt => [num(attr(el, 'x')) * sx, num(attr(el, 'y')) * sy];

    if ((attr(p, 'fill') ?? 'norm') !== 'none') anyFill = true;
    const st = attr(p, 'stroke');
    if (st !== '0' && st !== 'false') anyStroke = true;

    let cx = 0, cy = 0;
    for (let cmd = p.firstElementChild; cmd; cmd = cmd.nextElementSibling) {
      const pts = kids(cmd, 'pt');
      switch (cmd.localName) {
        case 'moveTo':
          [cx, cy] = ptOf(pts[0]);
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
          const stAng = num(attr(cmd, 'stAng')) / DEG;
          const swAng = num(attr(cmd, 'swAng')) / DEG;
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
          break;
      }
    }
  }

  const d = out.join(' ');
  if (!d.trim()) return null;
  return { d, open: !anyFill && anyStroke };
}
