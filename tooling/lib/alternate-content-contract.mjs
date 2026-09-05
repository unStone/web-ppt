import { unzipSync } from 'fflate';
import { makeZip } from './ooxml.mjs';

/** 回退是源对象的渲染投影；只经公开解析/渲染接口检查，不调用 MC 内部选择器。 */
export async function runAlternateContentContract({ core, bytes, eq, check }) {
  const presentation = await core.parse(bytes, { lazy: false, edit: true, keepPackage: true });
  try {
    const elements = presentation.slides[0].elements;
    eq('ChartEx 回退只投影一个对象', elements.length, 1);
    const image = elements[0];
    eq('未知 ChartEx 显示 Office 兼容图片', image?.kind, 'image');
    if (image?.kind !== 'image') return;
    eq('回退保留原对象身份', image.id, 6);
    eq('回退只允许框架级编辑', image.editInfo?.editable, 'frame');
    eq('回退位置保持来源值', image.x, 40);
    eq('回退大小保持来源值', image.w, 400);
    const asset = presentation.package.assets[image.src];
    check('回退引用真实 PNG 字节', asset?.sourcePart === 'ppt/media/chart-preview.png'
      && asset.bytes[0] === 137 && asset.bytes[1] === 80);
    for (const textMode of ['html', 'svg']) {
      const svg = core.renderSlideToSvg(presentation, presentation.slides[0], { textMode });
      eq(`回退图片进入 ${textMode} 输出`, (svg.match(/<image /g) ?? []).length, 1);
    }
  } finally { presentation.dispose?.(); }
  const parts = unzipSync(new Uint8Array(bytes));
  const slidePart = 'ppt/slides/slide1.xml';
  const missingFallback = new TextDecoder().decode(parts[slidePart])
    .replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/, '');
  const withoutFallback = await core.parse(makeZip(Object.entries({ ...parts,
    [slidePart]: new TextEncoder().encode(missingFallback),
  })), { lazy: false, edit: true });
  try {
    eq('缺少兼容回退时保留可见占位', withoutFallback.slides[0].elements[0]?.kind, 'unsupported');
    eq('缺少兼容回退时仍保留源身份', withoutFallback.slides[0].elements[0]?.id, 6);
  } finally { withoutFallback.dispose?.(); }
  const declinedChart = new TextDecoder().decode(parts[slidePart])
    .replace('http://schemas.microsoft.com/office/drawing/2015/10/21/chartex',
      'http://schemas.microsoft.com/office/powerpoint/2010/main')
    .replace('uri="http://schemas.microsoft.com/office/drawing/2014/chartex"',
      'uri="http://schemas.openxmlformats.org/drawingml/2006/chart"');
  const declined = await core.parse(makeZip(Object.entries({ ...parts,
    [slidePart]: new TextEncoder().encode(declinedChart),
  })), { lazy: false });
  try {
    eq('已加载图表解析器无法解释内容时采用回退', declined.slides[0].elements[0]?.kind, 'image');
  } finally { declined.dispose?.(); }
}

export async function runAlternateContentSaveContract({ core, edit, bytes, eq, check }) {
  const sourceSnapshot = new Uint8Array(bytes);
  const presentation = await core.parse(bytes, { lazy: false, edit: true, keepPackage: true });
  const doc = edit.createDoc(presentation, { idPrefix: 'mc-' });
  const editor = new edit.Editor(doc);
  const id = doc.slides[doc.slideOrder[0]].children[0];
  try {
    editor.exec({ type: 'SetXfrm', id, x: 77 });
    const saved = await editor.save();
    check('保存不能改写调用方输入字节', Buffer.from(bytes).equals(Buffer.from(sourceSnapshot)));
    const originalParts = unzipSync(sourceSnapshot);
    const savedParts = unzipSync(saved);
    const slideXml = new TextDecoder().decode(savedParts['ppt/slides/slide1.xml']);
    eq('移动同步写回 Choice 与 Fallback', (slideXml.match(/x="733425"/g) ?? []).length, 2);
    for (const part of ['ppt/charts/chartEx1.xml', 'ppt/charts/_rels/chartEx1.xml.rels',
      'ppt/embeddings/chart-data.xlsx', 'ppt/media/chart-preview.png']) {
      check(`移动保留原始 ${part}`, Buffer.from(savedParts[part] ?? []).equals(Buffer.from(originalParts[part])));
    }
    const reopened = await core.parse(saved, { lazy: false });
    try {
      eq('保存重开保留兼容图片', reopened.slides[0].elements[0]?.kind, 'image');
      eq('保存重开保留新位置', reopened.slides[0].elements[0]?.x, 77);
    } finally { reopened.dispose?.(); }
    editor.undo();
    const restored = unzipSync(await editor.save());
    check('撤销保存恢复两套原始分支', Buffer.from(restored['ppt/slides/slide1.xml'])
      .equals(Buffer.from(originalParts['ppt/slides/slide1.xml'])));
    editor.exec({ type: 'SetName', id, name: '兼容图表' });
    const renamed = unzipSync(await editor.save());
    eq('重命名同步到两套分支', (new TextDecoder().decode(renamed['ppt/slides/slide1.xml'])
      .match(/name="兼容图表"/g) ?? []).length, 2);
    editor.exec({ type: 'SetAltText', id, title: '回退预览', descr: null });
    const described = unzipSync(await editor.save());
    eq('替代文字同步到两套分支', (new TextDecoder().decode(described['ppt/slides/slide1.xml'])
      .match(/title="回退预览"/g) ?? []).length, 2);
    let linkRejected = false;
    try { editor.exec({ type: 'SetLink', id, target: { kind: 'external', href: 'https://example.com/chart' } }); }
    catch { linkRejected = true; }
    check('框架级回退不扩大链接编辑权限', linkRejected);
  } finally { editor.dispose(); }
}
