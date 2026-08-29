import type {
  CustomGeometry, CustomGeometryCommand, CustomGeometryPoint, CustomGeometryScalar,
} from '@web-ppt/core';
import { materializeCustomGeometryArcs } from '@web-ppt/core/geometry';
import { assertDataArray, assertDataObject, own } from './data-validation';
import type { EditDoc, ElementId } from './types';

const MAX_GUIDES = 4096;
const MAX_PATHS = 256;
const MAX_COMMANDS = 16384;

function assertText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length > 4096) throw new Error(`${label} 必须是有限长度字符串`);
}

function assertFinite(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} 必须是有限数值`);
}

function assertScalar(value: unknown, label: string): asserts value is CustomGeometryScalar {
  assertDataObject(value, ['expression', 'value'], label);
  assertText((value as CustomGeometryScalar).expression, `${label}.expression`);
  assertFinite((value as CustomGeometryScalar).value, `${label}.value`);
}

function assertGuides(value: unknown, label: string): void {
  assertDataArray(value, label);
  if (value.length > MAX_GUIDES) throw new Error(`${label} 数量过多`);
  for (let index = 0; index < value.length; index++) {
    const guideLabel = `${label}[${index}]`;
    assertDataObject(value[index], ['name', 'formula'], guideLabel);
    const guide = value[index] as { name: unknown; formula: unknown };
    assertText(guide.name, `${guideLabel}.name`);
    assertText(guide.formula, `${guideLabel}.formula`);
  }
}

function expectedPointCount(command: CustomGeometryCommand): number {
  if (command.type === 'move' || command.type === 'line') return 1;
  if (command.type === 'quadratic') return 2;
  if (command.type === 'cubic') return 3;
  return 0;
}

export function assertCustomGeometry(value: unknown, label: string): asserts value is CustomGeometry {
  assertDataObject(value, ['adjustments', 'guides', 'paths'], label);
  const geometry = value as CustomGeometry;
  assertGuides(geometry.adjustments, `${label}.adjustments`);
  assertGuides(geometry.guides, `${label}.guides`);
  assertDataArray(geometry.paths, `${label}.paths`);
  if (geometry.paths.length > MAX_PATHS) throw new Error(`${label}.paths 数量过多`);
  const ids = new Set<string>();
  const uniqueId = (id: unknown, idLabel: string): string => {
    assertText(id, idLabel);
    if (!id || ids.has(id)) throw new Error(`${idLabel} 必须是唯一非空字符串`);
    ids.add(id);
    return id;
  };
  let commandCount = 0;
  geometry.paths.forEach((path, pathIndex) => {
    const pathLabel = `${label}.paths[${pathIndex}]`;
    assertDataObject(path, [
      'id', 'width', 'height', 'fill', 'stroke', 'extrusionOk', 'closed', 'commands',
    ], pathLabel);
    uniqueId(path.id, `${pathLabel}.id`);
    if (path.id !== `p${pathIndex}`) throw new Error(`${pathLabel}.id 必须使用稳定顺序地址`);
    assertFinite(path.width, `${pathLabel}.width`);
    assertFinite(path.height, `${pathLabel}.height`);
    if (path.width <= 0 || path.height <= 0) throw new Error(`${pathLabel} 的坐标空间必须大于零`);
    assertText(path.fill, `${pathLabel}.fill`);
    if (typeof path.stroke !== 'boolean' || typeof path.extrusionOk !== 'boolean'
      || typeof path.closed !== 'boolean') throw new Error(`${pathLabel} 的标志必须是布尔值`);
    assertDataArray(path.commands, `${pathLabel}.commands`);
    commandCount += path.commands.length;
    if (commandCount > MAX_COMMANDS) throw new Error(`${label} 的命令数量过多`);
    path.commands.forEach((command, commandIndex) => {
      const commandLabel = `${pathLabel}.commands[${commandIndex}]`;
      const arc = command.type === 'arc';
      assertDataObject(command, arc
        ? ['id', 'type', 'points', 'widthRadius', 'heightRadius', 'startAngle', 'sweepAngle']
        : ['id', 'type', 'points'], commandLabel);
      uniqueId(command.id, `${commandLabel}.id`);
      if (command.id !== `${path.id}-c${commandIndex}`) {
        throw new Error(`${commandLabel}.id 必须使用稳定顺序地址`);
      }
      if (!['move', 'line', 'cubic', 'quadratic', 'arc', 'close'].includes(command.type)) {
        throw new Error(`${commandLabel}.type 无效`);
      }
      assertDataArray(command.points, `${commandLabel}.points`);
      if (command.points.length !== expectedPointCount(command)) {
        throw new Error(`${commandLabel} 的点数量无效`);
      }
      command.points.forEach((point, pointIndex) => {
        const pointLabel = `${commandLabel}.points[${pointIndex}]`;
        assertDataObject(point, ['id', 'role', 'x', 'y'], pointLabel);
        uniqueId(point.id, `${pointLabel}.id`);
        const expectedPointId = `${command.id}-${pointIndex === command.points.length - 1 ? 'a' : `c${pointIndex}`}`;
        if (point.id !== expectedPointId) throw new Error(`${pointLabel}.id 必须使用稳定顺序地址`);
        if (!['anchor', 'control'].includes(point.role)) throw new Error(`${pointLabel}.role 无效`);
        if ((pointIndex === command.points.length - 1) !== (point.role === 'anchor')) {
          throw new Error(`${pointLabel}.role 与路径点位置不一致`);
        }
        assertScalar(point.x, `${pointLabel}.x`);
        assertScalar(point.y, `${pointLabel}.y`);
      });
      if (command.type === 'arc') {
        assertScalar(command.widthRadius, `${commandLabel}.widthRadius`);
        assertScalar(command.heightRadius, `${commandLabel}.heightRadius`);
        assertScalar(command.startAngle, `${commandLabel}.startAngle`);
        assertScalar(command.sweepAngle, `${commandLabel}.sweepAngle`);
      }
    });
  });
}

function scalarMatchesNumber(value: CustomGeometryScalar): boolean {
  if (!/^-?\d+(?:\.\d+)?$/.test(value.expression)) return false;
  const parsed = Number(value.expression);
  return Number.isFinite(parsed) && parsed === value.value;
}

/** 投影读 value、保存写 expression；覆盖边界必须保证二者不会形成两套真相。 */
export function assertCustomGeometryOverride(
  current: CustomGeometry | null,
  value: unknown,
  label: string,
): asserts value is CustomGeometry {
  assertCustomGeometry(value, label);
  if (current && (JSON.stringify(value.adjustments) !== JSON.stringify(current.adjustments)
    || JSON.stringify(value.guides) !== JSON.stringify(current.guides))) {
    throw new Error(`${label} 不能改写 avLst/gdLst；调整柄使用独立命令`);
  }
  if (!current && (value.adjustments.length || value.guides.length)) {
    throw new Error(`${label} 不能凭空创建 avLst/gdLst`);
  }
  const sourcePoints = new Map(current?.paths.flatMap((path) => path.commands.flatMap(
    (command) => command.points.map((point) => [point.id, point] as const),
  )) ?? []);
  const sourceCommands = new Map(current?.paths.flatMap((path) =>
    path.commands.map((command) => [command.id, command] as const)) ?? []);
  const sourceScalars = current?.paths.flatMap((path) => path.commands.flatMap((command) => [
    ...command.points.flatMap((point) => [point.x, point.y]),
    ...(command.type === 'arc' ? [
      command.widthRadius, command.heightRadius, command.startAngle, command.sweepAngle,
    ] : []),
  ])) ?? [];
  const sourceScalarKeys = new Set(sourceScalars.map((scalarValue) =>
    `${scalarValue.expression}\0${String(scalarValue.value)}`));
  const consistentScalar = (
    scalarValue: CustomGeometryScalar,
    source: CustomGeometryScalar | undefined,
    scalarLabel: string,
  ): void => {
    if (scalarMatchesNumber(scalarValue)) return;
    const matches = (candidate: CustomGeometryScalar) =>
      candidate.expression === scalarValue.expression && candidate.value === scalarValue.value;
    if (!(source && matches(source))
      && !sourceScalarKeys.has(`${scalarValue.expression}\0${String(scalarValue.value)}`)) {
      throw new Error(`${label} 的 ${scalarLabel} 表达式与求值不一致`);
    }
  };
  for (const path of value.paths) {
    for (const command of path.commands) {
      if (command.type === 'arc') {
        const source = sourceCommands.get(command.id);
        const sourceArc = source?.type === 'arc' ? source : undefined;
        for (const field of ['widthRadius', 'heightRadius', 'startAngle', 'sweepAngle'] as const) {
          consistentScalar(command[field], sourceArc?.[field], `${command.id}.${field}`);
        }
      }
      for (const point of command.points) {
        const source = sourcePoints.get(point.id);
        for (const axis of ['x', 'y'] as const) {
          consistentScalar(point[axis], source?.[axis], `${point.id}.${axis}`);
        }
      }
    }
  }
}

export function queryElementCustomGeometry(doc: EditDoc, id: ElementId): CustomGeometry | null {
  const record = doc.elements[id];
  if (!record || record.src.kind !== 'shape') return null;
  const geometry = own(record.ovr, 'geometry') ? record.ovr.geometry : record.meta.customGeometry;
  return geometry ? materializeCustomGeometryArcs(structuredClone(geometry)) : null;
}

function numericScalar(value: number): CustomGeometryScalar {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return { expression: String(rounded), value: rounded };
}

export function moveCustomGeometryPoint(
  geometry: CustomGeometry,
  pointId: string,
  position: { readonly x: number; readonly y: number },
): CustomGeometry {
  assertCustomGeometry(geometry, 'geometry');
  assertDataObject(position, ['x', 'y'], 'position');
  assertFinite(position.x, 'position.x');
  assertFinite(position.y, 'position.y');
  if (typeof pointId !== 'string' || !pointId) throw new Error('pointId 必须是非空字符串');
  let found = false;
  const paths = geometry.paths.map((path) => ({
    ...path,
    commands: path.commands.map((command) => command.type === 'arc' ? { ...command } : ({
      ...command,
      points: command.points.map((point) => {
        if (point.id !== pointId) return { ...point };
        found = true;
        return {
          ...point,
          x: numericScalar(position.x),
          y: numericScalar(position.y),
        };
      }),
    })),
  })) as CustomGeometry['paths'];
  if (!found) throw new Error(`找不到自定义几何点：${pointId}`);
  return { adjustments: [...geometry.adjustments], guides: [...geometry.guides], paths };
}

function replacePath(
  geometry: CustomGeometry,
  pathId: string,
  update: (path: CustomGeometry['paths'][number]) => CustomGeometry['paths'][number],
): CustomGeometry {
  let found = false;
  const paths = geometry.paths.map((path) => {
    if (path.id !== pathId) return path;
    found = true;
    return update(path);
  });
  if (!found) throw new Error(`找不到自定义几何路径：${pathId}`);
  return { adjustments: [...geometry.adjustments], guides: [...geometry.guides], paths };
}

export function setCustomGeometryClosed(
  geometry: CustomGeometry,
  pathId: string,
  closed: boolean,
): CustomGeometry {
  assertCustomGeometry(geometry, 'geometry');
  if (typeof closed !== 'boolean') throw new Error('closed 必须是布尔值');
  return replacePath(geometry, pathId, (path) => ({ ...path, closed }));
}

export function setCustomGeometrySegmentType(
  geometry: CustomGeometry,
  pathId: string,
  commandId: string,
  type: 'line' | 'cubic',
): CustomGeometry {
  assertCustomGeometry(geometry, 'geometry');
  if (type !== 'line' && type !== 'cubic') throw new Error('线段类型必须是 line 或 cubic');
  return replacePath(geometry, pathId, (path) => {
    const index = path.commands.findIndex((command) => command.id === commandId);
    const command = path.commands[index];
    if (!command || !['line', 'cubic', 'quadratic'].includes(command.type)) {
      throw new Error(`命令不支持线段类型切换：${commandId}`);
    }
    if (command.type === type) return path;
    const anchor = command.points[command.points.length - 1]!;
    let replacement: CustomGeometryCommand;
    if (type === 'line') {
      replacement = { id: command.id, type: 'line', points: [{ ...anchor }] };
    } else {
      let previous: CustomGeometryPoint | undefined;
      let subpathStart: CustomGeometryPoint | undefined;
      for (const candidate of path.commands.slice(0, index)) {
        if (candidate.type === 'close') {
          previous = subpathStart;
          continue;
        }
        previous = candidate.points[candidate.points.length - 1];
        if (candidate.type === 'move') subpathStart = previous;
      }
      if (!previous) throw new Error(`线段缺少可寻址起点：${commandId}`);
      const control = (
        from: CustomGeometryPoint, to: CustomGeometryPoint, ratio: number, id: string,
      ): CustomGeometryPoint => {
        const x = from.x.value + (to.x.value - from.x.value) * ratio;
        const y = from.y.value + (to.y.value - from.y.value) * ratio;
        return {
          id, role: 'control',
          x: numericScalar(x),
          y: numericScalar(y),
        };
      };
      replacement = {
        id: command.id, type: 'cubic', points: [
          command.type === 'quadratic'
            ? control(previous, command.points[0], 2 / 3, `${command.id}-c0`)
            : control(previous, anchor, 1 / 3, `${command.id}-c0`),
          command.type === 'quadratic'
            ? control(anchor, command.points[0], 2 / 3, `${command.id}-c1`)
            : control(previous, anchor, 2 / 3, `${command.id}-c1`),
          { ...anchor },
        ],
      };
    }
    const commands = [...path.commands];
    commands[index] = replacement;
    return { ...path, commands };
  });
}
