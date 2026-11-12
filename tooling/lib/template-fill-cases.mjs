export function createTemplateFillOutline(imageBytes) {
  return {
    version: 1,
    slides: [
      { type: 'title', title: 'Template acceptance', subtitle: 'Deterministic content', notes: 'Speaker notes' },
      { type: 'section', title: 'Overview', body: [{ text: 'A native editable presentation' }] },
      {
        type: 'content',
        title: 'Progress',
        body: [
          { text: 'Revenue grows', level: 0, bullet: true },
          { text: 'Margins improve', level: 1, bullet: true },
        ],
      },
      {
        type: 'two-column',
        title: 'Comparison',
        columns: [[{ text: 'Previous period', bullet: false }], [{ text: 'Current period', bullet: false }]],
      },
      {
        type: 'image',
        title: 'Product image',
        image: { bytes: imageBytes, mime: 'image/png', altText: 'Deterministic image', fit: 'cover' },
        body: [{ text: 'Native image caption' }],
      },
      {
        type: 'chart',
        title: 'Regional results',
        chart: {
          type: 'bar',
          title: 'Sales',
          categories: ['North', 'South'],
          series: [
            { name: 'Actual', values: [4, 7] },
            { name: 'Budget', values: [3, 5] },
          ],
        },
      },
    ],
  };
}

export const TEMPLATE_FILL_GEOMETRY_CHECKS = ['off-canvas', 'element-overlap', 'placeholder-prompt-left', 'image-distorted'];
