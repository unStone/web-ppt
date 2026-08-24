import { diffPackageBytes } from '../diff-package.mjs';

const bodyProps = (text) => ({
  anchor: text.anchor,
  insets: text.insets,
  wrap: text.wrap,
  vert: text.vert ?? 'horz',
  anchorCtr: text.anchorCtr ?? false,
  columns: text.columns ?? 1,
  columnGap: text.columnGap ?? 0,
  autoFit: text.autoFitShape ? 'shape' : text.autoFitNormal || text.autoFitCompute ? 'normal' : 'none',
});

const byName = (elements, name) => elements.find((element) => element.name === name);
const shapeFragment = (xml, name) => {
  const named = xml.indexOf(`name="${name}"`);
  const from = xml.lastIndexOf('<p:sp>', named);
  const to = xml.indexOf('</p:sp>', named);
  return from >= 0 && to >= 0 ? xml.slice(from, to + 7) : '';
};

/** bodyPr 写回必须只触碰被选字段，段落与未知子树仍保持原词法。 */
export async function runBodyPropsSaveContract({
  core, edit, load, check, eq, saveArtifact, renderFingerprint,
}) {
  console.log('\n\x1b[36m▸ 文字框属性保存与重开\x1b[0m');
  const scenario = Object.freeze({
    type: 'bodyProps', file: 'sample-editor-body-props.pptx', targetName: '继承文字框属性',
    changes: [
      { targetName: '继承文字框属性', props: {
        anchor: null, insets: null, wrap: null, vert: null, anchorCtr: null,
        columns: null, columnGap: null, autoFit: null,
      } },
      { targetName: '文字方向-水平', props: {
        anchor: 'bottom', insets: [3, 4, 5, 6], wrap: false,
        vert: 'wordArtVert', anchorCtr: true, columns: 2, columnGap: 15, autoFit: 'normal',
      } },
      { targetName: '自动适应-无', props: { autoFit: 'shape' } },
      { targetName: '自动适应-缩小', props: { autoFit: 'none' } },
      { targetName: '空文字框属性', props: {
        anchor: 'middle', insets: [1, 2, 3, 4], wrap: true, vert: 'vert270', autoFit: 'none',
      } },
      { targetName: '分栏与锚点', props: {
        anchor: 'bottom', insets: [10, 14, 12, 18], wrap: true,
        columns: 2, columnGap: 24, autoFit: 'none',
      } },
    ],
  });
  const input = load(scenario.file);
  const presentation = await core.parse(input, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const doc = edit.createDoc(presentation, { idPrefix: 'body-props-save-' });
  const editor = new edit.Editor(doc);
  for (const change of scenario.changes) {
    const record = Object.values(doc.elements).find((candidate) => candidate.src.name === change.targetName);
    editor.exec({ type: 'SetBodyProps', id: record.id, props: change.props });
  }
  const expected = Object.fromEntries(scenario.changes.map((change) => {
    const record = Object.values(doc.elements).find((candidate) => candidate.src.name === change.targetName);
    const element = editor.effectiveElement(record.id);
    return [change.targetName, { props: edit.queryBodyProps(doc, record.id), frame: {
      x: element.x, y: element.y, w: element.w, h: element.h,
    } }];
  }));
  const saved = await editor.saveDetailed();
  const artifact = saveArtifact('body-props-editing.pptx', saved.bytes);
  const diff = diffPackageBytes(input, saved.bytes);
  check('文字框属性保存只重写目标页的单一 ZIP entry',
    saved.mode === 'passthrough' && saved.rewrittenEntries === 1
      && diff.added.length === 0 && diff.removed.length === 0
      && diff.changed.join(',') === 'ppt/slides/slide1.xml');

  const reopened = await core.parse(saved.bytes, {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const reopenedDoc = edit.createDoc(reopened, { idPrefix: 'body-props-reopen-' });
  for (const [name, value] of Object.entries(expected)) {
    const element = byName(reopened.slides[0].elements, name);
    const record = Object.values(reopenedDoc.elements)
      .find((candidate) => candidate.src.name === name);
    const actualProps = element?.kind === 'shape' && element.text
      ? bodyProps(element.text) : edit.queryBodyProps(reopenedDoc, record.id);
    check(`${name} 的 bodyPr 与派生 frame 保存重开精确一致`,
      element?.kind === 'shape' && JSON.stringify(actualProps) === JSON.stringify(value.props)
        && JSON.stringify({ x: element.x, y: element.y, w: element.w, h: element.h })
          === JSON.stringify(value.frame));
  }
  const xml = new TextDecoder().decode(reopened.package.parts['ppt/slides/slide1.xml']);
  check('清除本层属性只删除直设并保留 bodyPr 未知节点、warp、extLst 和段落词法',
    xml.includes('<?body-props keep="yes"?>')
      && xml.includes('<!--body-props:keep-->')
      && xml.includes('<a:prstTxWarp prst="textWave1">')
      && xml.includes('<x:keep xmlns:x="urn:web-ppt:test" value="yes"/>')
      && xml.includes('<a:t>继承与清除必须可见</a:t>'));
  check('互斥 autofit 与 bodyPr 单位映射落在目标宿主',
    xml.includes('vert="wordArtVert"')
      && xml.includes(`spcCol="${Math.round(15 * 9525)}"`)
      && xml.includes('<a:noAutofit/>')
      && xml.includes('<a:normAutofit/>')
      && xml.includes('<a:spAutoFit/>'));
  check('显式 none 即使等于默认有效值也写成本层 noAutofit',
    shapeFragment(xml, '空文字框属性').includes('<a:noAutofit/>'));

  const projectedFingerprint = renderFingerprint(scenario.file, 'projected', scenario);
  const savedFingerprint = renderFingerprint(artifact, 'saved', scenario);
  for (const mode of ['html', 'svg']) {
    eq(`文字框属性保存产物 ${mode} 指纹等于独立进程有效投影`,
      savedFingerprint[mode], projectedFingerprint[mode]);
  }
  edit.disposeDoc(reopenedDoc);
  reopened.dispose?.();
  edit.disposeDoc(doc);
}
