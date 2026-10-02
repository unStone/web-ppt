import type { AnimEffect } from './types';

const PRESET_EFFECT: Record<number, AnimEffect> = {
  1: 'appear', 2: 'fly', 3: 'blinds', 4: 'zoom', 5: 'checkerboard', 6: 'circle',
  7: 'fly', 8: 'diamond', 9: 'dissolve', 10: 'fade', 11: 'appear', 12: 'fly',
  13: 'plus', 14: 'randomBar', 15: 'spin', 16: 'split', 17: 'stretch', 18: 'strips',
  19: 'swivel', 20: 'wheel', 21: 'wheel', 22: 'wipe', 23: 'zoom', 24: 'random',
  25: 'bounce', 26: 'bounce', 28: 'fade', 29: 'float', 30: 'float', 31: 'grow',
  32: 'spin', 33: 'float', 34: 'swivel', 35: 'fly', 36: 'stretch', 37: 'stretch',
  38: 'fly', 39: 'float', 40: 'spin', 41: 'swivel', 42: 'float', 43: 'fly',
  44: 'spin', 45: 'stretch', 46: 'stretch', 47: 'float', 48: 'zoom', 49: 'fly',
  50: 'stretch', 51: 'swivel', 52: 'stretch', 53: 'grow', 59: 'grow', 61: 'spin',
  62: 'fade',
};

const SUBTYPE_DIR: Record<number, string> = {
  1: 'u', 2: 'r', 4: 'd', 8: 'l', 3: 'rd', 6: 'ru', 9: 'lu', 12: 'ld',
  5: 'horz', 10: 'vert', 16: 'in', 32: 'out',
  26: 'in-vert', 42: 'out-vert', 21: 'in-horz', 37: 'out-horz',
};

const FILTER_EFFECT: Record<string, AnimEffect> = {
  fade: 'fade', wipe: 'wipe', barn: 'split', blinds: 'blinds', box: 'zoom',
  checkerboard: 'checkerboard', circle: 'circle', diamond: 'diamond',
  dissolve: 'dissolve', plus: 'plus', randombar: 'randomBar', slide: 'fly',
  strips: 'strips', wedge: 'wheel', wheel: 'wheel', image: 'fade',
};

// 24 的 filter 已是演示文稿记录的具体随机结果，应按该 filter 播放。
const PRESET_WITH_COMPONENT_FILTER = new Set([19, 26, 30, 31, 62]);

export function resolveAnimationEffect(
  presetID: number, subtype: number, filter?: string,
): { effect: AnimEffect; dir?: string } {
  const preset = PRESET_EFFECT[presetID];
  const match = filter?.match(/^([a-zA-Z]+)(?:\(([^)]*)\))?/);
  const name = match?.[1].toLowerCase();
  const arg = (match?.[2] ?? '').toLowerCase();
  const filtered = name ? FILTER_EFFECT[name] : undefined;
  const effect = (PRESET_WITH_COMPONENT_FILTER.has(presetID) ? preset : filtered ?? preset) ?? 'fade';

  if (name === 'box') return { effect: 'zoom', dir: arg === 'out' ? 'out' : 'in' };
  if (name === 'circle' || name === 'diamond' || name === 'plus') {
    return { effect, dir: arg === 'in' ? 'in' : 'out' };
  }
  if (name === 'barn') {
    return { effect, dir: `${arg.startsWith('in') ? 'in' : 'out'}-${arg.includes('vertical') ? 'vert' : 'horz'}` };
  }
  if (name === 'wheel') return { effect, dir: arg || String(subtype || 1) };
  if (name === 'checkerboard') return { effect, dir: arg === 'down' ? 'down' : 'across' };
  if (name === 'randombar' || name === 'blinds') {
    return { effect, dir: arg.startsWith('vert') ? 'vert' : 'horz' };
  }
  if (name === 'strips') {
    const dirs: Record<string, string> = {
      downleft: 'ld', upleft: 'lu', downright: 'rd', upright: 'ru',
    };
    return { effect, dir: dirs[arg] ?? SUBTYPE_DIR[subtype] };
  }
  if (name === 'wipe' || name === 'slide') {
    const side = arg.includes('left') ? 'l' : arg.includes('right') ? 'r'
      : arg.includes('top') || arg.includes('up') ? 'u'
        : arg.includes('bottom') || arg.includes('down') ? 'd' : undefined;
    const opposite: Record<string, string> = { l: 'r', r: 'l', u: 'd', d: 'u' };
    return { effect, dir: side && (arg.startsWith('from') ? side : opposite[side]) };
  }
  // 23 的纯 animScale 没有盒状滤镜；subtype 16 表示从零缩放，不表示盒状向内。
  if (presetID === 23 && !filter) return { effect, dir: undefined };
  return { effect, dir: SUBTYPE_DIR[subtype] };
}
