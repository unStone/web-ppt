import type { SpacePoint } from './space';

export interface SnapBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SnapTarget {
  id: string;
  bounds: SnapBounds;
}

export interface SnapMargins {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface AlignmentSnapGuide {
  kind: 'alignment';
  axis: 'x' | 'y';
  position: number;
  start: number;
  end: number;
  source: 'canvas-center' | 'canvas-edge' | 'page-margin' | 'element-edge' | 'element-center';
}

export interface SpacingSnapGuide {
  kind: 'spacing';
  axis: 'x' | 'y';
  cross: number;
  intervals: readonly [
    { start: number; end: number },
    { start: number; end: number },
  ];
  source: 'equal-spacing';
}

export type SnapGuide = AlignmentSnapGuide | SpacingSnapGuide;

export interface MoveSnapRequest {
  bounds: SnapBounds;
  delta: SpacePoint;
  threshold: number;
  siblings: readonly SnapTarget[];
  slide: { width: number; height: number };
  margins?: SnapMargins;
}

export interface MoveSnapResult {
  delta: SpacePoint;
  guides: SnapGuide[];
}

interface AxisCandidate {
  adjustment: number;
  key: string;
  priority: number;
  position: number;
  guide: {
    kind: 'alignment';
    crossStart: number;
    crossEnd: number;
    source: AlignmentSnapGuide['source'];
  } | {
    kind: 'spacing';
    intervals: SpacingSnapGuide['intervals'];
    source: 'equal-spacing';
  };
}

const compareKey = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function compareCandidate(left: AxisCandidate, right: AxisCandidate): number {
  return left.priority - right.priority
    || Math.abs(left.adjustment) - Math.abs(right.adjustment)
    || left.position - right.position || compareKey(left.key, right.key);
}

function choose(candidates: readonly AxisCandidate[], threshold: number): AxisCandidate | null {
  let best: AxisCandidate | null = null;
  for (const candidate of candidates) {
    if (Math.abs(candidate.adjustment) > threshold) continue;
    if (!best || compareCandidate(candidate, best) < 0) best = candidate;
  }
  return best;
}

function edgeCandidates(
  moving: readonly [number, number],
  targets: readonly SnapTarget[],
  axis: 'x' | 'y',
): AxisCandidate[] {
  const result: AxisCandidate[] = [];
  for (const target of targets) {
    const targetEdges: readonly [number, number] = axis === 'x'
      ? [target.bounds.left, target.bounds.right]
      : [target.bounds.top, target.bounds.bottom];
    moving.forEach((source, sourceIndex) => targetEdges.forEach((position, targetIndex) => {
      result.push({
        adjustment: position - source,
        key: `${sourceIndex}/${targetIndex}/${target.id}`,
        priority: 1,
        position,
        guide: {
          kind: 'alignment',
          crossStart: axis === 'x' ? target.bounds.top : target.bounds.left,
          crossEnd: axis === 'x' ? target.bounds.bottom : target.bounds.right,
          source: 'element-edge',
        },
      });
    }));
  }
  return result;
}

function centerCandidates(
  center: number,
  targets: readonly SnapTarget[],
  axis: 'x' | 'y',
): AxisCandidate[] {
  return targets.map((target) => {
    const position = axis === 'x'
      ? (target.bounds.left + target.bounds.right) / 2
      : (target.bounds.top + target.bounds.bottom) / 2;
    return {
      adjustment: position - center,
      key: `center/${target.id}`,
      priority: 2,
      position,
      guide: {
        kind: 'alignment' as const,
        crossStart: axis === 'x' ? target.bounds.top : target.bounds.left,
        crossEnd: axis === 'x' ? target.bounds.bottom : target.bounds.right,
        source: 'element-center' as const,
      },
    };
  });
}

function canvasEdgeCandidates(
  moving: readonly [number, number],
  axis: 'x' | 'y',
  slide: MoveSnapRequest['slide'],
): AxisCandidate[] {
  const size = axis === 'x' ? slide.width : slide.height;
  const crossSize = axis === 'x' ? slide.height : slide.width;
  return [
    {
      adjustment: -moving[0], key: 'canvas-edge/min', priority: 1, position: 0,
      guide: { kind: 'alignment', crossStart: 0, crossEnd: crossSize, source: 'canvas-edge' },
    },
    {
      adjustment: size - moving[1], key: 'canvas-edge/max', priority: 1, position: size,
      guide: { kind: 'alignment', crossStart: 0, crossEnd: crossSize, source: 'canvas-edge' },
    },
  ];
}

function marginCandidates(
  moving: readonly [number, number],
  axis: 'x' | 'y',
  request: MoveSnapRequest,
): AxisCandidate[] {
  if (!request.margins) return [];
  const positions: readonly [number, number] = axis === 'x'
    ? [request.margins.left, request.slide.width - request.margins.right]
    : [request.margins.top, request.slide.height - request.margins.bottom];
  const crossSize = axis === 'x' ? request.slide.height : request.slide.width;
  return positions.map((position, index) => ({
    adjustment: position - moving[index],
    key: `page-margin/${index}`,
    priority: 1,
    position,
    guide: {
      kind: 'alignment' as const, crossStart: 0, crossEnd: crossSize, source: 'page-margin' as const,
    },
  }));
}

interface AxisTarget {
  id: string;
  min: number;
  center: number;
  max: number;
  crossMin: number;
  crossMax: number;
}

function axisTarget(target: SnapTarget, axis: 'x' | 'y'): AxisTarget {
  const min = axis === 'x' ? target.bounds.left : target.bounds.top;
  const max = axis === 'x' ? target.bounds.right : target.bounds.bottom;
  return {
    id: target.id, min, center: (min + max) / 2, max,
    crossMin: axis === 'x' ? target.bounds.top : target.bounds.left,
    crossMax: axis === 'x' ? target.bounds.bottom : target.bounds.right,
  };
}

/** 只保留移动框两侧最近的两个兄弟，因此等距候选仍是 O(n) 而不需要空间索引。 */
function spacingCandidates(
  moved: SnapBounds,
  targets: readonly SnapTarget[],
  axis: 'x' | 'y',
): AxisCandidate[] {
  const movingMin = axis === 'x' ? moved.left : moved.top;
  const movingMax = axis === 'x' ? moved.right : moved.bottom;
  const movingCrossMin = axis === 'x' ? moved.top : moved.left;
  const movingCrossMax = axis === 'x' ? moved.bottom : moved.right;
  const before: AxisTarget[] = [];
  const after: AxisTarget[] = [];
  for (const target of targets.map((candidate) => axisTarget(candidate, axis))) {
    const crossOverlap = Math.min(movingCrossMax, target.crossMax)
      - Math.max(movingCrossMin, target.crossMin);
    if (crossOverlap <= 1e-9) continue;
    if (target.max <= movingMin) {
      before.push(target);
      before.sort((left, right) => right.max - left.max || compareKey(left.id, right.id));
      if (before.length > 2) before.length = 2;
    } else if (target.min >= movingMax) {
      after.push(target);
      after.sort((left, right) => left.min - right.min || compareKey(left.id, right.id));
      if (after.length > 2) after.length = 2;
    }
  }
  const size = movingMax - movingMin;
  const candidates: AxisCandidate[] = [];
  const add = (
    adjustment: number,
    key: string,
    intervals: SpacingSnapGuide['intervals'],
  ) => candidates.push({
    adjustment, key, priority: 3, position: movingMin + adjustment,
    guide: { kind: 'spacing', intervals, source: 'equal-spacing' },
  });
  if (before.length === 2) {
    const [near, far] = before;
    const gap = near.min - far.max;
    if (gap >= 0) {
      const desiredMin = near.max + gap;
      add(desiredMin - movingMin, `spacing/after/${far.id}/${near.id}`, [
        { start: far.max, end: near.min }, { start: near.max, end: desiredMin },
      ]);
    }
  }
  if (after.length === 2) {
    const [near, far] = after;
    const gap = far.min - near.max;
    if (gap >= 0) {
      const desiredMax = near.min - gap;
      add(desiredMax - movingMax, `spacing/before/${near.id}/${far.id}`, [
        { start: desiredMax, end: near.min }, { start: near.max, end: far.min },
      ]);
    }
  }
  if (before[0] && after[0]) {
    const [left, right] = [before[0], after[0]];
    const gap = (right.min - left.max - size) / 2;
    if (gap >= 0) {
      const desiredMin = left.max + gap;
      add(desiredMin - movingMin, `spacing/between/${left.id}/${right.id}`, [
        { start: left.max, end: desiredMin }, { start: desiredMin + size, end: right.min },
      ]);
    }
  }
  return candidates;
}

export function normalizeSnapMargins(
  margins: SnapMargins | undefined,
  slide: MoveSnapRequest['slide'],
): SnapMargins | undefined {
  if (!margins) return undefined;
  const values = [margins.left, margins.right, margins.top, margins.bottom];
  if (!values.every((value) => Number.isFinite(value) && value >= 0)
    || margins.left + margins.right >= slide.width
    || margins.top + margins.bottom >= slide.height) {
    throw new Error('吸附页边距必须是页面内的有限非负值');
  }
  return { ...margins };
}

function shiftedBounds(bounds: SnapBounds, delta: SpacePoint): SnapBounds {
  return {
    left: bounds.left + delta.x, top: bounds.top + delta.y,
    right: bounds.right + delta.x, bottom: bounds.bottom + delta.y,
  };
}

/** 阈值和候选都在幻灯片空间，DOM 缩放与父组矩阵不会改变求解结果。 */
export function snapMove(request: MoveSnapRequest): MoveSnapResult {
  const moved = shiftedBounds(request.bounds, request.delta);
  const horizontal = choose([
    ...edgeCandidates([moved.left, moved.right], request.siblings, 'x'),
    ...canvasEdgeCandidates([moved.left, moved.right], 'x', request.slide),
    ...marginCandidates([moved.left, moved.right], 'x', request),
    ...centerCandidates((moved.left + moved.right) / 2, request.siblings, 'x'),
    ...spacingCandidates(moved, request.siblings, 'x'),
    {
      adjustment: request.slide.width / 2 - (moved.left + moved.right) / 2,
      key: 'canvas-center/x', priority: 0, position: request.slide.width / 2,
      guide: {
        kind: 'alignment', crossStart: 0, crossEnd: request.slide.height, source: 'canvas-center',
      },
    },
  ], request.threshold);
  const vertical = choose([
    ...edgeCandidates([moved.top, moved.bottom], request.siblings, 'y'),
    ...canvasEdgeCandidates([moved.top, moved.bottom], 'y', request.slide),
    ...marginCandidates([moved.top, moved.bottom], 'y', request),
    ...centerCandidates((moved.top + moved.bottom) / 2, request.siblings, 'y'),
    ...spacingCandidates(moved, request.siblings, 'y'),
    {
      adjustment: request.slide.height / 2 - (moved.top + moved.bottom) / 2,
      key: 'canvas-center/y', priority: 0, position: request.slide.height / 2,
      guide: {
        kind: 'alignment', crossStart: 0, crossEnd: request.slide.width, source: 'canvas-center',
      },
    },
  ], request.threshold);
  const delta = {
    x: request.delta.x + (horizontal?.adjustment ?? 0),
    y: request.delta.y + (vertical?.adjustment ?? 0),
  };
  const finalBounds = shiftedBounds(request.bounds, delta);
  const guides: SnapGuide[] = [];
  const toGuide = (axis: 'x' | 'y', candidate: AxisCandidate): SnapGuide => {
    if (candidate.guide.kind === 'spacing') return {
      kind: 'spacing', axis,
      cross: axis === 'x'
        ? (finalBounds.top + finalBounds.bottom) / 2
        : (finalBounds.left + finalBounds.right) / 2,
      intervals: candidate.guide.intervals,
      source: candidate.guide.source,
    };
    return {
      kind: 'alignment', axis, position: candidate.position,
      start: Math.min(
        axis === 'x' ? finalBounds.top : finalBounds.left,
        candidate.guide.crossStart,
      ),
      end: Math.max(
        axis === 'x' ? finalBounds.bottom : finalBounds.right,
        candidate.guide.crossEnd,
      ),
      source: candidate.guide.source,
    };
  };
  if (horizontal) guides.push(toGuide('x', horizontal));
  if (vertical) guides.push(toGuide('y', vertical));
  return { delta, guides };
}
