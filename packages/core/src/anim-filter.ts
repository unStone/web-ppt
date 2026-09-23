import type { AnimEffect } from './types';

/**
 * p:animEffect@filter，如 "wipe(up)" / "barn(inVertical)" / "checkerboard(down)"。
 * 完整参数先匹配。`includes('left')` 写在横竖前面时，
 * strips(downLeft) 会变成 l，checkerboard(down) 会变成 d。
 */
export function effectFromFilter(filter: string): { effect: AnimEffect; dir?: string } | null {
  const matched = filter.match(/^([a-zA-Z]+)(?:\(([^)]*)\))?/);
  if (!matched) return null;
  const name = matched[1].toLowerCase();
  const arg = (matched[2] ?? '').toLowerCase();
  const table: Record<string, AnimEffect> = {
    fade: 'fade', wipe: 'wipe', barn: 'split', blinds: 'blinds', box: 'zoom',
    checkerboard: 'checker', circle: 'circle', diamond: 'diamond', dissolve: 'dissolve',
    plus: 'plus', randombar: 'randomBar', slide: 'fly', strips: 'strips',
    wedge: 'wheel', wheel: 'wheel', image: 'fade',
  };
  const effect = table[name];
  if (!effect) return null;
  const specific = specificDir(name, arg);
  if (specific) return { effect, dir: specific };
  return { effect, dir: sideDir(arg) };
}

function specificDir(name: string, arg: string): string | undefined {
  if (name === 'checkerboard') return arg.includes('down') ? 'vert' : 'horz';
  if (name === 'randombar') return arg.includes('vertical') ? 'vert' : 'horz';
  if (name === 'strips') {
    const horizontal = arg.includes('left') ? 'l' : 'r';
    const vertical = arg.includes('down') ? 'd' : 'u';
    return horizontal + vertical;
  }
  if (name === 'wheel') {
    const spokes = Number(arg);
    return spokes === 1 || spokes === 2 || spokes === 3 || spokes === 8 ? String(spokes) : '4';
  }
  if (name === 'wedge') return '1';
  if (name === 'circle' || name === 'diamond' || name === 'plus') {
    return arg.includes('out') ? 'out' : 'in';
  }
  if (name === 'barn') {
    const axis = arg.includes('horizontal') ? 'horz' : 'vert';
    const way = arg.includes('out') ? 'out' : 'in';
    return `${axis}-${way}`;
  }
  return undefined;
}

function sideDir(arg: string): string | undefined {
  const from = arg.startsWith('from');
  const side = arg.includes('left') ? 'l' : arg.includes('right') ? 'r'
    : arg.includes('top') || arg.includes('up') ? 'u'
      : arg.includes('bottom') || arg.includes('down') ? 'd' : null;
  const flip: Record<string, string> = { l: 'r', r: 'l', u: 'd', d: 'u' };
  if (side) return from ? side : flip[side];
  if (arg.includes('vertical')) return 'vert';
  if (arg.includes('horizontal')) return 'horz';
  if (arg.includes('in')) return 'in';
  if (arg.includes('out')) return 'out';
  return undefined;
}
