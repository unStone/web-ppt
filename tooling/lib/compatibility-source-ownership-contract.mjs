import { unzipSync } from 'fflate';
import { makeZip } from './ooxml.mjs';
import { runCompatibilityGeneratedCopiesContract } from './compatibility-generated-save-contract.mjs';

export async function runCompatibilityGeneratedDeduplicatedContract(context) {
  const parts = unzipSync(context.bytes);
  parts['ppt/media/zz-duplicate.png'] = parts['ppt/media/chart-preview.png'];
  await runCompatibilityGeneratedCopiesContract({ ...context, bytes: makeZip(Object.entries(parts)) });
  parts['ppt/charts/aa-chartEx.xml'] = parts['ppt/charts/chartEx1.xml'];
  parts['ppt/charts/_rels/aa-chartEx.xml.rels'] = parts['ppt/charts/_rels/chartEx1.xml.rels'];
  parts['[Content_Types].xml'] = new TextEncoder().encode(new TextDecoder().decode(parts['[Content_Types].xml'])
    .replace('</Types>', '<Override PartName="/ppt/charts/aa-chartEx.xml" ContentType="application/vnd.ms-office.chartex+xml"/></Types>'));
  await runCompatibilityGeneratedCopiesContract({ ...context, bytes: makeZip(Object.entries(parts)) });
}

export async function runCompatibilitySourceOwnershipContract({ core, edit, bytes, check, eq }) {
  const view = await core.parse(bytes, { lazy: false });
  try { check('普通查看不保留编辑用兼容源资源', !view.editInfo?.assets); }
  finally { view.dispose(); }
  const presentation = await core.parse(bytes, { lazy: true, edit: true, keepPackage: true });
  const doc = edit.createDoc(presentation);
  const editor = new edit.Editor(doc);
  try {
    const assets = presentation.editInfo.assets;
    const paths = assets.map((asset) => asset.url.replace('web-ppt-source:', '')).sort();
    eq('编辑会话只保留兼容对象的必要来源与依赖', paths.join(','), [
      '[Content_Types].xml', 'ppt/slides/slide1.xml', 'ppt/slides/_rels/slide1.xml.rels',
      'ppt/charts/chartEx1.xml', 'ppt/charts/_rels/chartEx1.xml.rels',
      'ppt/embeddings/chart-data.xlsx', 'ppt/media/chart-preview.png',
    ].sort().join(','));
    check('兼容源字节与原包按引用共享，不在元素或历史中复制', assets.every((asset) =>
      asset.bytes === presentation.package.parts[asset.url.replace('web-ppt-source:', '')]));
    presentation.dispose();
    eq('释放 Presentation 后不再持有兼容资源目录', presentation.editInfo.assets.length, 0);
    check('编辑文档独立持有生成保存所需字节', (await editor.save()).length > 0);
  } finally { editor.dispose(); }
}

export async function runCompatibilityGeneratedMissingDependencyContract({ core, edit, bytes, check }) {
  const parts = unzipSync(bytes);
  delete parts['ppt/embeddings/chart-data.xlsx'];
  const presentation = await core.parse(makeZip(Object.entries(parts)), { lazy: false, edit: true, keepPackage: true });
  const editor = new edit.Editor(edit.createDoc(presentation));
  try {
    editor.exec({ type: 'SetXfrm', id: editor.doc.slides[editor.doc.slideOrder[0]].children[0], x: 92 });
    presentation.dispose();
    let message = '';
    try { await editor.save(); } catch (error) { message = String(error); }
    check('缺少工作簿时明确拒绝生成残缺兼容包', /兼容对象缺少原包依赖.*chart-data.xlsx/.test(message));
    check('保存失败不清除未保存标志与历史', editor.isDirty() && editor.history.undoCount === 1);
  } finally { editor.dispose(); }
}
