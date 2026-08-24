/** 模型不变量只从公开入口验证，防止测试复刻实现细节。 */
export async function runModelInvariantContract({ edit, core, load, check }) {
  console.log('\n\x1b[36m▸ 命令边界模型不变量\x1b[0m');
  if (!check('公开 validateEditDoc', typeof edit.validateEditDoc === 'function')) return;
  const bytes = load('sample-edit-basic.pptx');
  if (!check('不变量固件存在', !!bytes)) return;
  const pres = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false });
  const base = edit.createDoc(pres, { idPrefix: 'invariant-' });
  const records = Object.values(base.elements);
  const shape = records.find((record) => record.src.name === '普通形状');
  const group = records.find((record) => record.src.kind === 'group');
  const frame = records.find((record) => record.meta.editable === 'frame');
  if (!check('不变量固件元素身份完整', !!shape && !!group && !!frame)) return;

  const rejects = (name, mutate) => {
    const candidate = structuredClone(base);
    mutate(candidate);
    let rejected = false;
    try { edit.validateEditDoc(candidate); } catch { rejected = true; }
    check(name, rejected);
  };

  let valid = true;
  try { edit.validateEditDoc(base); } catch { valid = false; }
  check('有效文档通过全局不变量', valid);
  rejects('拒绝孤儿元素', (doc) => {
    doc.slides[doc.slideOrder[0]].children = doc.slides[doc.slideOrder[0]].children
      .filter((id) => id !== shape.id);
  });
  rejects('拒绝重复或倒置的兄弟 z 序', (doc) => {
    const children = doc.slides[doc.slideOrder[0]].children;
    doc.elements[children[1]].z = doc.elements[children[0]].z;
  });
  rejects('拒绝非法稀疏层级键', (doc) => { doc.elements[shape.id].order = 'bad-0'; });
  rejects('拒绝 children 与有效层级键顺序不一致', (doc) => {
    const children = doc.slides[doc.slideOrder[0]].children;
    doc.elements[children[0]].order = edit.fractionalIndexBetween(
      doc.elements[children.at(-1)].z, null, children[0],
    );
  });
  rejects('拒绝为零的组子坐标范围', (doc) => { doc.elements[group.id].src.scaleX = 0; });
  rejects('拒绝没有段落的文本体', (doc) => { doc.elements[shape.id].src.text.paragraphs = []; });
  rejects('拒绝同一 part 内重复的可写 spid', (doc) => {
    doc.elements[frame.id].meta.origin = { ...doc.elements[shape.id].meta.origin };
  });
  rejects('拒绝指向不存在 OPC part 的写回锚点', (doc) => {
    doc.elements[shape.id].meta.origin.part = 'ppt/slides/missing.xml';
  });
  rejects('拒绝非组元素拥有 children', (doc) => { doc.elements[shape.id].children = []; });

  const invalid = structuredClone(base);
  invalid.slides[invalid.slideOrder[0]].children = [];
  let constructorRejected = false;
  try { new edit.Editor(invalid); } catch { constructorRejected = true; }
  check('Editor 在会话入口拒绝非法模型', constructorRejected);

  const guarded = structuredClone(base);
  const guardedEditor = new edit.Editor(guarded);
  guarded.elements[shape.id].src.text.paragraphs = [];
  const beforeRejectedCommit = JSON.stringify(guarded.elements[shape.id].ovr);
  let commitRejected = false;
  try { guardedEditor.exec({ type: 'SetXfrm', id: shape.id, x: shape.src.x + 1 }); } catch {
    commitRejected = true;
  }
  check('事务边界重验受影响元素且失败后回滚', commitRejected
    && JSON.stringify(guarded.elements[shape.id].ovr) === beforeRejectedCommit);

  const brokenParent = structuredClone(base);
  const brokenParentEditor = new edit.Editor(brokenParent);
  brokenParent.elements[shape.id].parent = 'missing-parent';
  const beforeBrokenParent = JSON.stringify(brokenParent.elements[shape.id].ovr);
  let brokenParentRejected = false;
  try { brokenParentEditor.exec({ type: 'SetXfrm', id: shape.id, x: shape.src.x + 2 }); } catch {
    brokenParentRejected = true;
  }
  check('失效阶段失败发生在 patch 落模前', brokenParentRejected
    && JSON.stringify(brokenParent.elements[shape.id].ovr) === beforeBrokenParent);
  edit.disposeDoc(base);
}
