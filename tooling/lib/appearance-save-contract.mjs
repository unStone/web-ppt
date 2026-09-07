import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { JSDOM } from 'jsdom';
import { bundleBrowser } from './bundle-browser.mjs';

export async function runAppearanceSaveContract({ load, check, eq, root, out }) {
  const entry = join(out, 'appearance-entry.mjs');
  // 公共查询必须与 Editor 共用投影缓存；独立内联两份 edit-core 不能模拟 peer 依赖。
  writeFileSync(entry, Object.entries({ core: 'core/src/index.ts', edit: 'edit-core/src/index.ts',
    appearance: 'edit-core/src/appearance/index.ts' }).map(([name, path]) =>
    `export * as ${name} from ${JSON.stringify(join(root, 'packages', path))};`).join('\n'));
  const { core, edit, appearance } = await bundleBrowser({ root, entry, output: join(out, 'appearance.mjs'),
    aliases: [['@web-ppt/core/geometry', join(root, 'packages/core/src/geometry/index.ts')],
      ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
      ['@web-ppt/edit-core', join(root, 'packages/edit-core/src/index.ts')]],
  });
  const source = load('sample-editor-appearance.pptx');
  const open = async () => {
    const p = await core.parse(source, { edit: true, keepPackage: true, lazy: false });
    const doc = edit.createDoc(p, { idPrefix: 'appearance-' });
    return { p, doc, editor: new edit.Editor(doc) };
  };
  const byName = (doc, name) => Object.values(doc.elements).find((record) => record.src.name === name).id;
  const unsupported = await open();
  const sourceDuotone = byName(unsupported.doc, 'picture-903');
  for (const id of [...unsupported.doc.slides[unsupported.doc.slideOrder[0]].children]) {
    if (id !== sourceDuotone) unsupported.editor.exec({ type: 'RemoveElement', id });
  }
  unsupported.p.dispose();
  let protectedSource = false;
  try { await unsupported.editor.save(); } catch (error) { protectedSource = String(error).includes('图片滤镜'); }
  check('未注册外观扩展不能生成保存并静默丢失来源双色调', protectedSource);
  unsupported.editor.dispose();
  for (const generated of [false, true]) {
    const { p, doc, editor } = await open();
    const api = appearance.createAppearanceEditor(editor);
    const image = byName(doc, 'picture-901'), shape = byName(doc, 'plain-shape');
    const frames = [];
    editor.subscribeRecovery((frame) => frames.push(structuredClone(frame)));
    const effects = { alpha: .45, grayscale: true, duotone: ['#102030', '#F0C080'] };
    const scene = { extrusion: 20, bevelTop: 3, bevelBottom: 2, material: 'metal',
      contourWidth: 1, contourColor: '#FF0000', extrusionColor: '#102030', rotX: 25, rotY: 40 };
    api.exec({ type: 'SetPictureFx', id: image, effects });
    api.exec({ type: 'SetScene3D', id: shape, scene });
    const pictureBefore = appearance.queryPictureFx(doc, image);
    const sceneBefore = appearance.queryScene3D(doc, shape);
    check('双色调投影包含实际颜色', JSON.stringify(pictureBefore.duotone) === '["rgb(16,32,48)","rgb(240,192,128)"]');
    eq('材质深度查询保持原始输入', sceneBefore.extrusion, 20);
    editor.undo();
    check('立体撤销恢复来源', !editor.effectiveElement(shape).scene3d);
    editor.redo();
    eq('立体重做恢复实际几何深度，材质不改尺寸', editor.effectiveElement(shape).scene3d.extrusion, 20);
    const remote = await open();
    for (const frame of frames) if (frame.patches.length) remote.editor.applyExternalPatches(frame.patches);
    check('外观协同补丁重建相同投影', JSON.stringify(appearance.queryPictureFx(remote.doc, image)) === JSON.stringify(pictureBefore)
      && JSON.stringify(appearance.queryScene3D(remote.doc, shape)) === JSON.stringify(sceneBefore));
    const recovered = await open();
    const recoveryEditor = new edit.Editor(recovered.doc, { recoveryFrames: frames });
    eq('恢复日志重建图片效果', appearance.queryPictureFx(recovered.doc, image).alpha, .45);
    recoveryEditor.dispose(); recovered.p.dispose(); remote.editor.dispose(); remote.p.dispose();
    let rejected = 0;
    for (const command of [
      { type: 'SetPictureFx', id: image, effects: { alpha: NaN } },
      { type: 'SetPictureFx', id: image, effects: { alpha: 2 } },
      { type: 'SetPictureFx', id: image, effects: { duotone: ['red', '#fff'] } },
      { type: 'SetScene3D', id: image, scene: {} },
      { type: 'SetScene3D', id: shape, scene: { material: 'unknown' } },
      { type: 'SetScene3D', id: shape, scene: { extrusion: -1 } },
    ]) { try { api.exec(command); } catch { rejected++; } }
    eq('拒绝错误目标与不可写回效果', rejected, 6);
    if (generated) p.dispose();
    const saved = await editor.save();
    writeFileSync(join(out, generated ? 'appearance-generated.pptx' : 'appearance-patched.pptx'), saved);
    const parts = unzipSync(saved);
    const xml = new TextDecoder().decode(parts['ppt/slides/slide1.xml']);
    const dom = new JSDOM(xml, { contentType: 'application/xml' });
    const elements = (name) => [...dom.window.document.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', name)];
    check('每个立体场景包含必需的相机与灯光', elements('scene3d').every((node) =>
      [...node.children].map((child) => child.localName).join(',') === 'camera,lightRig'));
    check('双色调写回两个颜色节点', elements('duotone').every((node) => node.children.length === 2));
    if (!generated) check('图片效果保留来源未知扩展与裁剪', xml.includes('test:keep') && xml.includes('l="10000"'));
    dom.window.close();
    const reopened = await core.parse(saved, { edit: true, keepPackage: true, lazy: false });
    const reopenedDoc = edit.createDoc(reopened);
    const imageAfter = appearance.queryPictureFx(reopenedDoc, byName(reopenedDoc, 'picture-901'));
    const shapeAfter = appearance.queryScene3D(reopenedDoc, byName(reopenedDoc, 'plain-shape'));
    check('两条保存图片效果重开一致', JSON.stringify(imageAfter) === JSON.stringify(pictureBefore));
    check('两条保存立体效果重开一致', Object.keys(sceneBefore).every((key) => shapeAfter[key] === sceneBefore[key]));
    const repeat = new edit.Editor(reopenedDoc);
    const repeatApi = appearance.createAppearanceEditor(repeat);
    const zero = byName(reopenedDoc, 'plain-shape');
    repeatApi.exec({ type: 'SetScene3D', id: zero, scene: { extrusion: 0, bevelTop: 3, material: 'metal' } });
    const zeroSource = await core.parse(await repeat.save(), { lazy: false, edit: true, keepPackage: true });
    const zeroDoc = edit.createDoc(zeroSource), zeroEditor = new edit.Editor(zeroDoc);
    eq('显式零挤出补丁重开保留零', appearance.queryScene3D(zeroDoc, byName(zeroDoc, 'plain-shape')).extrusion, 0);
    zeroSource.dispose();
    const zeroGenerated = await core.parse(await zeroEditor.save(), { lazy: false });
    eq('零挤出再次生成保存不恢复隐式厚度', zeroGenerated.slides[0].elements.find((e) => e.name === 'plain-shape').scene3d.extrusion, 0);
    zeroGenerated.dispose(); zeroEditor.dispose();
    let allParametersRetained = true;
    for (const scene of [{ extrusion: 0 }, { bevelTop: 0 }, { bevelBottom: 0 }, { contourWidth: 0 },
      { contourColor: '#FF0000' }, { contourWidth: 0, contourColor: '#FF0000' },
      { extrusionColor: '#00FF00' }, { rotX: 0 }, { rotY: 0 }, { material: 'metal' },
      { bevelTop: 3, material: 'clear' }, { bevelBottom: 2, material: 'metal' }, {}]) {
      repeatApi.exec({ type: 'SetScene3D', id: zero, scene });
      const expected = appearance.queryScene3D(reopenedDoc, zero);
      if (generated) reopened.dispose();
      const roundtrip = await core.parse(await repeat.save(), { edit: true, lazy: false });
      const rd = edit.createDoc(roundtrip), actual = appearance.queryScene3D(rd, byName(rd, 'plain-shape'));
      const retained = Object.keys(expected).length === Object.keys(actual).length
        && Object.keys(expected).every((key) => typeof expected[key] === 'number'
          ? Math.abs(expected[key] - actual[key]) < 1e-10 : expected[key] === actual[key]);
      if (!retained) console.log('立体参数不一致', { scene, expected, actual });
      allParametersRetained &&= retained;
      roundtrip.dispose();
    }
    check('立体单属性、零值与组合矩阵保存保留全部参数', allParametersRetained);
    repeat.dispose();
    api.exec({ type: 'SetPictureFx', id: image, effects: {} });
    api.exec({ type: 'SetScene3D', id: shape, scene: {} });
    const cleared = await core.parse(await editor.save(), { lazy: false });
    check('两条保存空对象清除全部外观覆盖', !cleared.slides[0].elements.find((e) => e.name === 'picture-901').duotone
      && !cleared.slides[0].elements.find((e) => e.name === 'plain-shape').scene3d);
    cleared.dispose();
    reopened.dispose();
    if (!generated) {
      api.exec({ type: 'SetPictureFx', id: image, effects: null });
      api.exec({ type: 'SetScene3D', id: shape, scene: null });
      const reset = await core.parse(await editor.save(), { lazy: false });
      check('保存后恢复来源并再次保存不会残留覆盖', !reset.slides[0].elements.find((e) => e.name === 'picture-901').duotone
        && !reset.slides[0].elements.find((e) => e.name === 'plain-shape').scene3d);
      reset.dispose();
    }
    editor.dispose(); p.dispose();
  }
}
