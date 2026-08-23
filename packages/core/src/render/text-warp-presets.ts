/** `<textPath>` 能表达的艺术字预设；包络型预设只能近似其基线方向。 */
const WARP_PRESETS = new Set([
  'textArchUp', 'textArchDown', 'textArchUpPour', 'textArchDownPour', 'textCircle',
  'textWave1', 'textWave2', 'textCurveUp', 'textCurveDown', 'textCanUp', 'textCanDown',
  'textTriangle', 'textChevron', 'textInflate', 'textDeflate',
]);

export const warpSupported = (preset: string | undefined): boolean =>
  !!preset && WARP_PRESETS.has(preset);
