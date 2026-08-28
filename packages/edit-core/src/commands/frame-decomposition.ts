import { composeSpaceMatrices } from '../space';
import type { AffineMatrix } from '../space';

const EPSILON = 1e-8;

/** PPTX frame 只能表达旋转、缩放与镜像；仿射矩阵含斜切时必须由调用者拒绝。 */
export function decomposeFrameMatrix(
  matrix: AffineMatrix,
  width: number,
  height: number,
  shearError: string,
) {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  const reflectH = determinant < 0;
  const normalized = reflectH ? composeSpaceMatrices(matrix, {
    a: -1, b: 0, c: 0, d: 1, e: width, f: 0,
  }) : matrix;
  const scaleX = Math.hypot(normalized.a, normalized.b);
  const scaleY = (normalized.a * normalized.d - normalized.b * normalized.c) / scaleX;
  const magnitude = Math.max(
    1, Math.abs(normalized.a), Math.abs(normalized.b), Math.abs(normalized.c), Math.abs(normalized.d),
  );
  const orthogonality = normalized.a * normalized.c + normalized.b * normalized.d;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 1e-12 || scaleY <= 1e-12
    || Math.abs(orthogonality) > EPSILON * magnitude * magnitude) {
    throw new Error(shearError);
  }
  const radians = Math.atan2(normalized.b, normalized.a);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const w = width * scaleX;
  const h = height * scaleY;
  return {
    x: normalized.e - w / 2 * (1 - cos) - h / 2 * sin,
    y: normalized.f + w / 2 * sin - h / 2 * (1 - cos),
    w, h, rot: radians * 180 / Math.PI, reflectH,
  };
}
