/** 保存矩阵供严格 XML 与 Office 验收共享，避免新增产物只被宽松重解析覆盖。 */
export const mediaArtifacts = [
  ...['', 'mp4-', 'fmp4-', 'external-audio-', 'external-video-', 'poster-imported-audio-', 'poster-imported-video-']
    .flatMap((prefix) => ['patched', 'generated'].map((mode) => ({ name: `${prefix}${mode}`, pages: 1 }))),
  ...['audio', 'video', 'external-audio', 'external-video'].flatMap((kind) =>
    ['patched', 'generated', 'legacy'].map((mode) => ({ name: `poster-${kind}-${mode}`, pages: mode === 'legacy' ? 2 : 1 }))),
];
