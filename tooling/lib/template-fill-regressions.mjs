import { makePng } from './ooxml.mjs';

export async function runTemplateFillRegressions({ api, template, options, assert }) {
  for (const field of ['title', 'notes'])
    for (const character of ['\u0000', '\uD800', '\uFFFE']) {
      await assert.rejects(
        () =>
          api.fill.fillTemplate(
            template,
            { version: 1, slides: [{ type: 'title', title: 'Valid title', [field]: `Invalid${character}XML` }] },
            options,
          ),
        (error) => error.reason === 'invalid-outline' && error.field?.includes(field) && error.slideNumber === 1,
      );
    }
  await assert.rejects(
    () => api.fill.fillTemplate(template, { version: 1, slides: [{ type: 'title', title: String.fromCharCode(0xd800) }] }, options),
    (error) => error.reason === 'invalid-outline',
  );
  const notes = 'Speaker 😀\tNotes\r\nSecond line\rThird line\nEnd';
  const legal = await api.fill.fillTemplate(
    template,
    { version: 1, slides: [{ type: 'title', title: 'Valid text', subtitle: 'A\tB\nC', notes }] },
    options,
  );
  assert.equal(
    legal.description.slides[0].notes,
    'Speaker 😀\tNotes\nSecond line\nThird line\nEnd',
    '合法 emoji/TAB/LF 必须保留，CR 行尾必须规范化为 LF',
  );
  assert(
    legal.description.slides[0].elements.some((element) => element.paragraphs.some((paragraph) => paragraph.text.includes('\t'))),
    '合法文字 TAB 必须保留',
  );

  const outline = { version: 1, slides: [{ type: 'title', title: 'Captured title' }] };
  const capturedOptions = { ...options, idPrefix: 'captured-before-' };
  const pending = api.fill.fillTemplate(template, outline, capturedOptions);
  capturedOptions.idPrefix = 'changed-after-';
  outline.slides[0].title = 'Changed after start';
  const captured = await pending;
  assert(
    captured.description.slides.every((slide) => slide.id.startsWith('captured-before-')),
    '异步生成必须捕获启动时的 options',
  );
  assert(
    captured.description.slides[0].elements.some((element) => element.paragraphs.some((paragraph) => paragraph.text === 'Captured title')),
    '异步生成必须捕获启动时的大纲内容',
  );

  const unchanged = {
    ...options,
    idPrefix: 'strict-captured-',
    requireClean: true,
    repair: false,
    lint: { ...options.lint, checks: ['off-canvas', 'missing-font'], fonts: { available: [], embedded: [] } },
  };
  const initial = api.fill.fillTemplate('aurora', { version: 1, slides: [{ type: 'title', title: 'Original template' }] }, unchanged);
  unchanged.idPrefix = 'strict-changed-';
  unchanged.requireClean = false;
  unchanged.repair = true;
  unchanged.lint.checks.splice(0, 2, 'off-canvas');
  unchanged.lint.fonts.available.push('Aptos', 'Aptos Display');
  unchanged.lint.fonts.embedded.push('Aptos', 'Aptos Display');
  await assert.rejects(
    () => initial,
    (error) =>
      error.reason === 'layout-invalid'
      && error.lint?.checks.includes('missing-font')
      && error.lint.issues.some((issue) => issue.reason === 'off-canvas' && issue.elementId.startsWith('strict-captured-'))
      && error.lint.issues.some((issue) => issue.reason === 'missing-font'),
    '严格开关、修复开关、检查数组和字体库存必须使用调用开始时的副本',
  );

  const large = {
    version: 1,
    slides: [{ type: 'content', title: 'Too much text', body: Array.from({ length: 120 }, () => ({ text: 'A native line' })) }],
  };
  const cleanOptions = { ...options, requireClean: true, lint: { ...options.lint, checks: ['off-canvas', 'text-overflow'] } };
  const strict = api.fill.fillTemplate(template, large, cleanOptions);
  cleanOptions.requireClean = false;
  await assert.rejects(
    () => strict,
    (error) => error.reason === 'layout-invalid' && error.lint?.issues.some((issue) => issue.reason === 'text-overflow'),
    '不能在调用后关闭严格验收',
  );
  const reported = await api.fill.fillTemplate(template, large, { ...cleanOptions, requireClean: false });
  assert(
    reported.lint.issues.some((issue) => issue.reason === 'text-overflow'),
    '不可修复溢出必须在显式诊断模式完整报告',
  );

  const source = await api.core.parse(template, { edit: true, keepPackage: true, lazy: false });
  const doc = api.edit.createDoc(source, { idPrefix: 'crop-edge-' });
  const editor = new api.edit.Editor(doc);
  try {
    const layout = api.edit.listLayouts(doc).find((layout) => layout.name === 'Fill Picture');
    const id = doc.layouts[layout.id].children.find((id) => doc.elements[id].meta.ph?.type === 'pic');
    editor.execDesign(layout.target, { type: 'SetXfrm', id, x: 500, y: 20, w: 100, h: 500 });
    const narrow = await editor.save();
    const picture = Buffer.from(makePng(20000, 1, () => [32, 64, 128])).toString('base64');
    const filled = await api.fill.fillTemplate(
      narrow,
      {
        version: 1,
        slides: [{ type: 'image', title: '', image: { bytes: picture, mime: 'image/png', fit: 'cover' }, layoutId: layout.id }],
      },
      options,
    );
    const reopened = await api.core.parse(filled.bytes, { edit: true, keepPackage: true, lazy: false });
    try {
      const image = reopened.slides[0].elements.find((element) => element.kind === 'image');
      assert(image?.crop, 'cover 必须产生真实原生裁剪');
      const width = 1 - image.crop.l - image.crop.r;
      assert(width > 0, '十万分之一边界不能把合法图片裁成零面积');
      assert.equal(Math.round(width * 100000), 1);
      assert(Math.abs(image.w / image.h / (20000 * width) - 1) < 1e-6, '整数裁剪必须保持图片比例');
    } finally {
      reopened.dispose();
    }
    editor.execDesign(layout.target, { type: 'SetXfrm', id, w: 1 });
    const unrepresentable = await editor.save();
    await assert.rejects(
      () =>
        api.fill.fillTemplate(
          unrepresentable,
          {
            version: 1,
            slides: [{ type: 'image', title: '', image: { bytes: picture, mime: 'image/png', fit: 'cover' }, layoutId: layout.id }],
          },
          options,
        ),
      (error) => error.reason === 'image-crop-unrepresentable',
    );
  } finally {
    editor.dispose();
    api.edit.disposeDoc(doc);
  }
}
