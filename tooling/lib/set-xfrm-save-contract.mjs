import { equalBytes } from './bytes.mjs';

const decoder = new TextDecoder();
const emu = (value) => String(Math.round(value * 9525));
const angle = (value) => String(Math.round(value * 60000));

function replaceOnce(source, before, after) {
  const at = source.indexOf(before);
  if (at < 0 || source.indexOf(before, at + before.length) >= 0) {
    throw new Error(`测试固件中的目标片段不唯一：${before}`);
  }
  return source.slice(0, at) + after + source.slice(at + before.length);
}

/** 只通过公开模型、Editor 与 save 入口验证 SetXfrm 的 OOXML 落点。 */
export async function runSetXfrmSaveContract({ edit, save, core, load, check, eq }) {
  console.log('\n\x1b[36m▸ SetXfrm 精确写回 OOXML\x1b[0m');
  if (!check('公开按需保存入口', typeof save.saveEditDoc === 'function')) return;

  const bytes = load('sample-edit-xfrm.pptx');
  if (!check('找到确定性 SetXfrm 写回固件', !!bytes)) return;
  const pres = await core.parse(bytes, { edit: true, keepPackage: true, lazy: false, assets: 'defer' });
  const doc = edit.createDoc(pres, { idPrefix: 'xfrm-' });
  const editor = new edit.Editor(doc);
  const records = Object.values(doc.elements);
  const shape = records.find((record) => record.src.name === '异名前缀形状');
  const group = records.find((record) => record.src.name === '坐标组');
  const child = records.find((record) => record.src.name === '组内形状');
  const frame = records.find((record) => record.src.name === '框架对象');
  const placeholder = records.find((record) => record.src.name === '继承占位符');
  if (!check('固件覆盖形状、组、组内元素、frame 与继承占位符',
    !!shape && !!group && !!child && !!frame && !!placeholder && !!placeholder.meta.ph)) return;

  const values = {
    shape: { x: 80.125, y: 91.25, w: 241.5, h: 131.75, rot: -7.25 },
    group: { w: 333.3, h: 200.2, rot: 12.5 },
    child: { x: 37.75 },
    frame: { x: 777.4, y: 111.6, w: 345.2, h: 222.8 },
    placeholder: { x: 222.2 },
  };
  editor.exec({ type: 'SetXfrm', id: shape.id, ...values.shape });
  editor.exec({ type: 'SetFlip', id: shape.id, h: true, v: true });
  editor.exec({ type: 'SetXfrm', id: group.id, ...values.group });
  editor.exec({ type: 'SetXfrm', id: child.id, ...values.child });
  let frameRotationRejected = false;
  try { editor.exec({ type: 'SetXfrm', id: frame.id, rot: 3.5 }); } catch { frameRotationRejected = true; }
  let frameFlipRejected = false;
  try { editor.exec({ type: 'SetFlip', id: frame.id, h: true }); } catch { frameFlipRejected = true; }
  check('frame 对象在命令边界拒绝旋转和翻转', frameRotationRejected && frameFlipRejected);
  editor.exec({ type: 'SetXfrm', id: frame.id, ...values.frame });
  editor.exec({ type: 'SetXfrm', id: placeholder.id, ...values.placeholder });
  check('编辑后 Editor 进入脏状态', editor.isDirty());

  const sourcePackage = doc.package;
  const sourcePart = sourcePackage.parts['ppt/slides/slide1.xml'];
  let expected = decoder.decode(sourcePart);
  expected = replaceOnce(expected,
    `<d:xfrm><d:off x="${emu(80)}" y="${emu(90)}"/><d:ext cx="${emu(240)}" cy="${emu(130)}"/></d:xfrm>`,
    `<d:xfrm rot="${angle(values.shape.rot)}" flipH="1" flipV="1"><d:off x="${emu(values.shape.x)}" y="${emu(values.shape.y)}"/><d:ext cx="${emu(values.shape.w)}" cy="${emu(values.shape.h)}"/></d:xfrm>`);
  expected = replaceOnce(expected,
    `<d:xfrm rot="600000"><d:off x="${emu(390)}" y="${emu(90)}"/><d:ext cx="${emu(320)}" cy="${emu(190)}"/><d:chOff x="${emu(10)}" y="${emu(20)}"/><d:chExt cx="${emu(160)}" cy="${emu(95)}"/></d:xfrm>`,
    `<d:xfrm rot="${angle(values.group.rot)}"><d:off x="${emu(390)}" y="${emu(90)}"/><d:ext cx="${emu(values.group.w)}" cy="${emu(values.group.h)}"/><d:chOff x="${emu(10)}" y="${emu(20)}"/><d:chExt cx="${emu(160)}" cy="${emu(95)}"/></d:xfrm>`);
  expected = replaceOnce(expected,
    `<d:xfrm><d:off x="${emu(25)}" y="${emu(35)}"/><d:ext cx="${emu(120)}" cy="${emu(70)}"/></d:xfrm>`,
    `<d:xfrm><d:off x="${emu(values.child.x)}" y="${emu(35)}"/><d:ext cx="${emu(120)}" cy="${emu(70)}"/></d:xfrm>`);
  expected = replaceOnce(expected,
    `<q:xfrm><d:off x="${emu(760)}" y="${emu(100)}"/><d:ext cx="${emu(330)}" cy="${emu(210)}"/></q:xfrm>`,
    `<q:xfrm><d:off x="${emu(values.frame.x)}" y="${emu(values.frame.y)}"/><d:ext cx="${emu(values.frame.w)}" cy="${emu(values.frame.h)}"/></q:xfrm>`);
  expected = replaceOnce(expected,
    '<q:spPr><d:prstGeom prst="roundRect">',
    `<q:spPr><d:xfrm><d:off x="${emu(values.placeholder.x)}" y="${emu(410)}"/><d:ext cx="${emu(520)}" cy="${emu(150)}"/></d:xfrm><d:prstGeom prst="roundRect">`);

  const originalDocument = globalThis.document;
  globalThis.document = undefined;
  let savedBytes;
  try {
    savedBytes = await editor.save();
  } finally {
    globalThis.document = originalDocument;
  }
  check('Editor.save 返回可继续解析的 PPTX 字节并标记保存点', savedBytes === doc.package.bytes
    && savedBytes !== sourcePackage.bytes && !editor.isDirty());
  const firstSavedPackage = doc.package;
  check('SetXfrm 保存链路可在 Worker 式无 DOM 环境运行', savedBytes.length > 0);
  const changedParts = Object.keys(sourcePackage.parts).filter((name) =>
    !equalBytes(sourcePackage.parts[name], doc.package.parts[name]));
  eq('五个元素位于同一页时只重写一个 slide part', JSON.stringify(changedParts),
    JSON.stringify(['ppt/slides/slide1.xml']));
  eq('写回只产生预期属性替换与占位符 xfrm 插入', decoder.decode(doc.package.parts[changedParts[0]]), expected);
  check('组的 chOff/chExt 与 frame 内部内容逐字保留', expected.includes(
    `<d:chOff x="${emu(10)}" y="${emu(20)}"/><d:chExt cx="${emu(160)}" cy="${emu(95)}"/>`)
    && expected.includes('<opaque:item xmlns:opaque="urn:web-ppt:opaque" keep="yes"/>'));

  const reparsed = await core.parse(savedBytes, { edit: true, keepPackage: true, lazy: false, assets: 'defer' });
  const byName = new Map();
  const visit = (elements) => elements.forEach((element) => {
    if (element.name) byName.set(element.name, element);
    if (element.kind === 'group') visit(element.children);
  });
  visit(reparsed.slides[0].elements);
  const geometryMatches = [
    ['异名前缀形状', values.shape], ['坐标组', values.group], ['组内形状', values.child],
    ['框架对象', values.frame], ['继承占位符', values.placeholder],
  ].every(([name, fields]) => Object.entries(fields).every(([field, value]) =>
    Math.abs(byName.get(name)?.[field] - value) < 1 / 9525));
  check('保存产物重新解析后所有显式几何与翻转逐字段回环', geometryMatches
    && byName.get('异名前缀形状')?.flipH === true && byName.get('异名前缀形状')?.flipV === true);

  const workerClone = structuredClone(doc);
  for (const record of Object.values(workerClone.elements)) record.ovr = {};
  save.saveEditDoc(workerClone);
  check('保存基线随 structuredClone 进入 Worker 并能恢复继承态',
    equalBytes(workerClone.package.parts['ppt/slides/slide1.xml'], sourcePart));
  edit.disposeDoc(workerClone);
  check('释放文档会清空保存基线字节', Object.keys(workerClone.saveState.baselines).length === 0);

  const identity = save.saveEditDoc(doc);
  check('同一覆盖重复保存保持字节和包句柄身份', identity.mode === 'identity'
    && identity.bytes === savedBytes && identity.package === doc.package);

  while (editor.undo()) { /* 回到首次编辑前 */ }
  check('保存后撤销全部操作会重新进入脏状态且清空覆盖', editor.isDirty()
    && Object.keys(shape.ovr).length === 0 && Object.keys(placeholder.ovr).length === 0);
  const revertedBytes = await editor.save();
  check('保存后撤销会把目标 part 恢复到首次触碰前而非错误 identity',
    equalBytes(doc.package.parts['ppt/slides/slide1.xml'], sourcePart)
    && !equalBytes(revertedBytes, savedBytes) && !editor.isDirty());
  check('连续保存替换包后立即释放上一个编辑器自有句柄',
    firstSavedPackage.disposed && firstSavedPackage.bytes.length === 0);
  while (editor.redo()) { /* 恢复全部编辑 */ }
  await editor.save();
  eq('撤销保存后再重做仍能恢复同一 OOXML 投影',
    decoder.decode(doc.package.parts['ppt/slides/slide1.xml']), expected);

  editor.exec({ type: 'SetFlip', id: shape.id, h: false });
  const unflipped = await editor.saveDetailed();
  const unflippedXml = decoder.decode(unflipped.package.parts['ppt/slides/slide1.xml']);
  check('SetFlip false 通过省略属性取消单轴翻转',
    !/<d:xfrm[^>]*flipH=/.test(unflippedXml) && /<d:xfrm[^>]*flipV="1"/.test(unflippedXml));

  editor.exec({ type: 'SetXfrm', id: shape.id, x: values.shape.x + 10 });
  const second = await editor.saveDetailed();
  check('刷新包后第二次修改仍走直通且只重写目标页', second.mode === 'passthrough'
    && second.rewrittenEntries === 1 && second.package === doc.package && !editor.isDirty());

  const beforeFailure = doc.package;
  const originalSpid = shape.meta.origin.spid;
  shape.meta.origin.spid = 999999;
  let missingAnchorRejected = false;
  try { save.saveEditDoc(doc); } catch { missingAnchorRejected = true; }
  shape.meta.origin.spid = originalSpid;
  check('溯源锚点不存在时原子拒绝且不替换当前包', missingAnchorRejected && doc.package === beforeFailure);

  const empty = edit.createEmptyDoc({ width: 1280, height: 720, idPrefix: 'empty-save-' });
  let generatedRejected = false;
  try { save.saveEditDoc(empty); } catch { generatedRejected = true; }
  check('未实现生成模式时给出明确失败而非伪造空包', generatedRejected);

  const inkPres = await core.parse(load('sample-media.pptx'), {
    edit: true, keepPackage: true, lazy: false, assets: 'defer',
  });
  const inkDoc = edit.createDoc(inkPres, { idPrefix: 'ink-save-' });
  const ink = Object.values(inkDoc.elements).find((record) => record.src.name === '墨迹 1');
  if (check('真实 p14:contentPart 墨迹保留 frame 可编辑锚点', !!ink && ink.meta.editable === 'frame')) {
    const inkX = ink.src.x + 19.5;
    new edit.Editor(inkDoc).exec({ type: 'SetXfrm', id: ink.id, x: inkX });
    const inkSaved = save.saveEditDoc(inkDoc);
    const inkReparsed = await core.parse(inkSaved.bytes, { edit: true, lazy: false, assets: 'defer' });
    const savedInk = inkReparsed.slides.flatMap((slide) => slide.elements)
      .find((element) => element.name === '墨迹 1');
    check('墨迹只改框架位置且 p14 写回可重新解析', Math.abs(savedInk?.x - inkX) < 1 / 9525);
    inkReparsed.dispose?.();
  }
  edit.disposeDoc(inkDoc);
  reparsed.dispose?.();
  edit.disposeDoc(doc);
}
