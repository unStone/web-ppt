/**
 * 渲染对照的灰度指标：SSIM（8×8 非重叠窗口）、MAE、Δmax、差异像素占比。
 *
 * compare-libreoffice.mjs 会把本文件剥掉 export 后以经典 <script> 内嵌进
 * compare.html（file:// 下 ES module 会被 CORS 拦掉），所以这里只放无 import
 * 的纯函数，不要引入依赖。
 */

/** RGBA（ImageData.data）转灰度：透明像素按白底合成，与对照画布的预填白一致 */
export function grayFromRgba(data, w, h) {
  const g = new Float64Array(w * h);
  for (let i = 0; i < g.length; i++) {
    const o = i * 4;
    const alpha = data[o + 3] / 255;
    g[i] = (data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114) * alpha + 255 * (1 - alpha);
  }
  return g;
}

/** 灰度 SSIM，8×8 非重叠窗口（C1/C2 取标准 0.01/0.03 × 255²） */
export function ssimGray(a, b, w, h) {
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2, B = 8;
  let sum = 0, n = 0;
  for (let by = 0; by + B <= h; by += B) for (let bx = 0; bx + B <= w; bx += B) {
    let ma = 0, mb = 0;
    for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) {
      ma += a[(by + y) * w + bx + x]; mb += b[(by + y) * w + bx + x];
    }
    ma /= B * B; mb /= B * B;
    let va = 0, vb = 0, cov = 0;
    for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) {
      const da = a[(by + y) * w + bx + x] - ma, db = b[(by + y) * w + bx + x] - mb;
      va += da * da; vb += db * db; cov += da * db;
    }
    va /= B * B - 1; vb /= B * B - 1; cov /= B * B - 1;
    sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++;
  }
  return n ? sum / n : 1;
}

/** MAE / Δmax / 差异像素（灰度差 >8）占比 / SSIM，一次算齐 */
export function grayMetrics(a, b, w, h) {
  let sum = 0, max = 0, diff = 0;
  for (let i = 0; i < w * h; i++) {
    const d = Math.abs(a[i] - b[i]);
    sum += d; if (d > max) max = d; if (d > 8) diff++;
  }
  return {
    mae: +(sum / (w * h)).toFixed(2),
    deltaMax: Math.round(max),
    diffRatioPct: +(diff / (w * h) * 100).toFixed(2),
    ssim: +ssimGray(a, b, w, h).toFixed(4),
  };
}
