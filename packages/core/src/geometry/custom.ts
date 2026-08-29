/** 自定义几何中的公式既要保留 OOXML 表达式，也要给编辑交互一个有限数值。 */
export interface CustomGeometryScalar {
  readonly expression: string;
  readonly value: number;
}

export interface CustomGeometryGuide {
  readonly name: string;
  readonly formula: string;
}

export type CustomGeometryPointRole = 'anchor' | 'control';

export interface CustomGeometryPoint {
  readonly id: string;
  readonly role: CustomGeometryPointRole;
  readonly x: CustomGeometryScalar;
  readonly y: CustomGeometryScalar;
}

interface CustomGeometryPointCommand {
  readonly id: string;
  readonly points: readonly CustomGeometryPoint[];
}

export interface CustomGeometryMoveCommand extends CustomGeometryPointCommand {
  readonly type: 'move';
}

export interface CustomGeometryLineCommand extends CustomGeometryPointCommand {
  readonly type: 'line';
}

export interface CustomGeometryCubicCommand extends CustomGeometryPointCommand {
  readonly type: 'cubic';
}

export interface CustomGeometryQuadraticCommand extends CustomGeometryPointCommand {
  readonly type: 'quadratic';
}

export interface CustomGeometryArcCommand {
  readonly id: string;
  readonly type: 'arc';
  readonly points: readonly [];
  readonly widthRadius: CustomGeometryScalar;
  readonly heightRadius: CustomGeometryScalar;
  readonly startAngle: CustomGeometryScalar;
  readonly sweepAngle: CustomGeometryScalar;
}

/** 同一 a:path 可以包含多个子路径；中间 close 不能折叠成路径级 closed。 */
export interface CustomGeometryCloseCommand {
  readonly id: string;
  readonly type: 'close';
  readonly points: readonly [];
}

export type CustomGeometryCommand = CustomGeometryMoveCommand | CustomGeometryLineCommand
  | CustomGeometryCubicCommand | CustomGeometryQuadraticCommand | CustomGeometryArcCommand
  | CustomGeometryCloseCommand;

export interface CustomGeometryPath {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly fill: string;
  readonly stroke: boolean;
  readonly extrusionOk: boolean;
  readonly closed: boolean;
  readonly commands: readonly CustomGeometryCommand[];
}

/** 只建模顶点编辑需要的部分；ahLst/cxnLst 等未知来源节点由保留型保存原样留下。 */
export interface CustomGeometry {
  readonly adjustments: readonly CustomGeometryGuide[];
  readonly guides: readonly CustomGeometryGuide[];
  readonly paths: readonly CustomGeometryPath[];
}

export interface ResolvedCustomGeometry {
  readonly d: string;
  readonly open: boolean;
}

const format = (value: number): string =>
  Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '0';

export type CubicArcSegment = readonly [
  control1: readonly [number, number],
  control2: readonly [number, number],
  anchor: readonly [number, number],
];

/** arcTo 没有可拖端点；编辑模型将它按不超过 90° 的段物化为可寻址三次贝塞尔。 */
export function arcToCubicSegments(
  fromX: number,
  fromY: number,
  widthRadius: number,
  heightRadius: number,
  startAngle: number,
  sweepAngle: number,
): readonly CubicArcSegment[] {
  if (![fromX, fromY, widthRadius, heightRadius, startAngle, sweepAngle].every(Number.isFinite)) return [];
  const rx = Math.abs(widthRadius);
  const ry = Math.abs(heightRadius);
  if (!sweepAngle) return [];
  const start = startAngle * Math.PI / 180;
  const centerX = fromX - rx * Math.cos(start);
  const centerY = fromY - ry * Math.sin(start);
  const count = Math.min(4096, Math.max(1, Math.ceil(Math.abs(sweepAngle) / 90)));
  const delta = sweepAngle / count * Math.PI / 180;
  const segments: CubicArcSegment[] = [];
  for (let index = 0; index < count; index++) {
    const a0 = start + delta * index;
    const a1 = a0 + delta;
    const k = 4 / 3 * Math.tan(delta / 4);
    const endX = centerX + rx * Math.cos(a1);
    const endY = centerY + ry * Math.sin(a1);
    segments.push([
      [centerX + rx * (Math.cos(a0) - k * Math.sin(a0)),
        centerY + ry * (Math.sin(a0) + k * Math.cos(a0))],
      [centerX + rx * (Math.cos(a1) + k * Math.sin(a1)),
        centerY + ry * (Math.sin(a1) - k * Math.cos(a1))],
      [endX, endY],
    ]);
  }
  return segments;
}

const numericScalar = (value: number): CustomGeometryScalar => {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return { expression: String(rounded), value: rounded };
};

/** 来源模型保留 arcTo；进入顶点编辑时才稳定物化，避免未编辑投影产生近似误差。 */
export function materializeCustomGeometryArcs(geometry: CustomGeometry): CustomGeometry {
  return {
    adjustments: [...geometry.adjustments],
    guides: [...geometry.guides],
    paths: geometry.paths.map((path, pathIndex) => {
      const pathId = `p${pathIndex}`;
      const commands: CustomGeometryCommand[] = [];
      let currentX = 0;
      let currentY = 0;
      let subpathX = 0;
      let subpathY = 0;
      for (const command of path.commands) {
        if (command.type === 'close') {
          commands.push({ id: `${pathId}-c${commands.length}`, type: 'close', points: [] });
          [currentX, currentY] = [subpathX, subpathY];
          continue;
        }
        if (command.type === 'arc') {
          const segments = arcToCubicSegments(
            currentX, currentY, command.widthRadius.value, command.heightRadius.value,
            command.startAngle.value / 60000, command.sweepAngle.value / 60000,
          );
          segments.forEach((segment) => {
            const id = `${pathId}-c${commands.length}`;
            const point = (
              [x, y]: readonly [number, number], index: 0 | 1 | 2,
            ): CustomGeometryPoint => ({
              id: `${id}-${index === 2 ? 'a' : `c${index}`}`,
              role: index === 2 ? 'anchor' : 'control',
              x: numericScalar(x), y: numericScalar(y),
            });
            const points = [point(segment[0], 0), point(segment[1], 1), point(segment[2], 2)] as const;
            commands.push({ id, type: 'cubic', points });
            [currentX, currentY] = [points[2].x.value, points[2].y.value];
          });
          continue;
        }
        const id = `${pathId}-c${commands.length}`;
        const clone = {
          ...command, id,
          points: command.points.map((point, pointIndex) => ({
            ...point,
            id: `${id}-${pointIndex === command.points.length - 1 ? 'a' : `c${pointIndex}`}`,
          })),
        };
        commands.push(clone);
        const anchor = clone.points[clone.points.length - 1];
        if (anchor) [currentX, currentY] = [anchor.x.value, anchor.y.value];
        if (command.type === 'move') [subpathX, subpathY] = [currentX, currentY];
      }
      return { ...path, id: pathId, commands };
    }),
  };
}

/** 编辑模型已持有公式求值结果；投影只负责从路径坐标空间缩放到当前 frame。 */
export function resolveCustomGeometry(
  geometry: CustomGeometry,
  width: number,
  height: number,
): ResolvedCustomGeometry {
  const out: string[] = [];
  let anyFill = false;
  let anyStroke = false;
  for (const path of geometry.paths) {
    const sx = path.width ? Math.max(width, 0) / path.width : 1;
    const sy = path.height ? Math.max(height, 0) / path.height : 1;
    const point = (value: CustomGeometryPoint): readonly [number, number] =>
      [value.x.value * sx, value.y.value * sy];
    if (path.fill !== 'none') anyFill = true;
    if (path.stroke) anyStroke = true;
    let cx = 0;
    let cy = 0;
    let startX = 0;
    let startY = 0;
    for (const command of path.commands) {
      if (command.type === 'close') {
        out.push('Z');
        cx = startX;
        cy = startY;
        continue;
      }
      if (command.type === 'arc') {
        const wr = command.widthRadius.value * sx;
        const hr = command.heightRadius.value * sy;
        const start = command.startAngle.value / 60000;
        const sweep = command.sweepAngle.value / 60000;
        const radians = start * Math.PI / 180;
        const centerX = cx - wr * Math.cos(radians);
        const centerY = cy - hr * Math.sin(radians);
        const steps = Math.max(1, Math.ceil(Math.abs(sweep) / 180));
        for (let index = 0; index < steps; index++) {
          const segment = sweep / steps;
          const angle = (start + segment * (index + 1)) * Math.PI / 180;
          cx = centerX + wr * Math.cos(angle);
          cy = centerY + hr * Math.sin(angle);
          out.push(`A ${format(wr)} ${format(hr)} 0 ${Math.abs(segment) > 180 ? 1 : 0} ${segment >= 0 ? 1 : 0} ${format(cx)} ${format(cy)}`);
        }
        continue;
      }
      const points = command.points.map(point);
      const anchor = points[points.length - 1] ?? [cx, cy];
      if (command.type === 'move') {
        out.push(`M ${format(anchor[0])} ${format(anchor[1])}`);
        [startX, startY] = anchor;
      }
      else if (command.type === 'line') out.push(`L ${format(anchor[0])} ${format(anchor[1])}`);
      else if (command.type === 'quadratic') {
        out.push(`Q ${format(points[0][0])} ${format(points[0][1])} ${format(anchor[0])} ${format(anchor[1])}`);
      } else {
        out.push(`C ${format(points[0][0])} ${format(points[0][1])} ${format(points[1][0])} ${format(points[1][1])} ${format(anchor[0])} ${format(anchor[1])}`);
      }
      [cx, cy] = anchor;
    }
    if (path.closed) out.push('Z');
  }
  return { d: out.join(' '), open: !anyFill && anyStroke };
}
