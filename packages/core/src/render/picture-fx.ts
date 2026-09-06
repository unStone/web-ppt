import { shapeColorChannels } from './shape-3d';

/** 将 sRGB 灰度与双色映射合成一个矩阵；最后一行原样保留 alpha。 */
export function duotoneFilter(colors: [string, string], id: string): string {
  const [dark, light] = colors.map(shapeColorChannels);
  const matrix = dark.flatMap((value, index) => [
    ...[.213, .715, .072].map((weight) => weight * (light[index] - value) / 255), 0, value / 255,
  ]);
  return `<filter id="${id}" color-interpolation-filters="sRGB"><feColorMatrix values="${matrix.join(' ')} 0 0 0 1 0"/></filter>`;
}
