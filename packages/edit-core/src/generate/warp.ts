import type { TextWarp } from '@web-ppt/core';

// ST_TextShapeType 定义原生保存范围；渲染器支持的基线近似预设是另一个边界。
const PRESETS = new Set(`textNoShape textPlain textStop textTriangle textTriangleInverted
textChevron textChevronInverted textRingInside textRingOutside textArchUp textArchDown
textCircle textButton textArchUpPour textArchDownPour textCirclePour textButtonPour
textCurveUp textCurveDown textCanUp textCanDown textWave1 textWave2 textDoubleWave1 textWave4
textInflate textDeflate textInflateBottom textDeflateBottom textInflateTop textDeflateTop
textDeflateInflate textDeflateInflateDeflate textFadeRight textFadeLeft textFadeUp textFadeDown
textSlantUp textSlantDown textCascadeUp textCascadeDown`.split(/\s+/));

export function warpMarkup(warp: TextWarp | undefined): string {
  if (!warp) return '';
  if (warp.generationIssues?.length) throw new Error(warp.generationIssues.join('、'));
  if (!PRESETS.has(warp.preset) || Object.entries(warp.adj).some(([name, value]) =>
    !/^[A-Za-z][\w]*$/.test(name) || !Number.isSafeInteger(value))) {
    throw new Error('艺术字预设或调整值无效');
  }
  const guides = Object.entries(warp.adj).map(([name, value]) => `<a:gd name="${name}" fmla="val ${value}"/>`).join('');
  return `<a:prstTxWarp prst="${warp.preset}"><a:avLst>${guides}</a:avLst></a:prstTxWarp>`;
}
