/**
 * 编辑投影与保存产物必须各自在干净进程渲染；渲染器的 defs id 是进程级序列，
 * 同进程比较会把测试顺序误当成文件差异。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { installDomEnv } from './dom-env.mjs';

const [corePath, editPath, file, mode, scenarioJson] = process.argv.slice(2);
if (!corePath || !editPath || !file || !scenarioJson || !['projected', 'saved'].includes(mode)) {
  console.error('用法: node m1-save-fingerprint.mjs <core.mjs> <edit.mjs> <file> <projected|saved> <scenario-json>');
  process.exit(2);
}
const scenario = JSON.parse(scenarioJson);

installDomEnv();
const core = await import(`${pathToFileURL(corePath).href}?worker=${process.pid}`);
const edit = await import(`${pathToFileURL(editPath).href}?worker=${process.pid}`);
const bytes = new Uint8Array(readFileSync(file));
const pres = await core.parse(bytes, {
  edit: mode === 'projected', keepPackage: true, lazy: false, assets: 'defer',
});
const slideIndex = scenario.resultSlideIndex ?? scenario.slideIndex ?? 0;
let slide = pres.slides[slideIndex];
let doc;
if (mode === 'projected') {
  doc = edit.createDoc(pres, { idPrefix: 'm1-fingerprint-' });
  const editor = new edit.Editor(doc);
  const target = Object.values(doc.elements).find((record) => record.src.name === scenario.targetName);
  if (scenario.type === 'clipboard') {
    const sourceBytes = new Uint8Array(readFileSync(join(dirname(file), scenario.sourceFile)));
    const sourcePres = await core.parse(sourceBytes, {
      edit: true, keepPackage: true, lazy: false, assets: 'defer',
    });
    const sourceDoc = edit.createDoc(sourcePres, { idPrefix: 'm1-fingerprint-source-' });
    const sourceTarget = Object.values(sourceDoc.elements)
      .find((record) => record.src.name === scenario.targetName);
    if (!sourceTarget) throw new Error('M1 指纹固件缺少剪贴板来源目标');
    editor.exec({
      type: 'PasteElements', payload: edit.copyElements(sourceDoc, [sourceTarget.id]),
      at: { parentId: doc.slideOrder[0], x: scenario.x, y: scenario.y },
    });
    edit.disposeDoc(sourceDoc);
  } else if (scenario.type === 'text') {
    for (const change of scenario.edits) {
      const textTarget = Object.values(doc.elements)
        .find((record) => record.src.name === change.targetName);
      if (!textTarget) throw new Error(`M1 指纹固件缺少文字目标：${change.targetName}`);
      editor.exec({
        type: 'EditText', id: textTarget.id,
        ...(change.cell ? { cell: change.cell } : {}), ops: change.ops,
      });
    }
    for (const change of scenario.formats ?? []) {
      const textTarget = Object.values(doc.elements)
        .find((record) => record.src.name === change.targetName);
      if (!textTarget) throw new Error(`M1 指纹固件缺少格式目标：${change.targetName}`);
      editor.exec({
        type: 'SetRunProps', id: textTarget.id,
        ...(change.cell ? { cell: change.cell } : {}), range: change.range, props: change.props,
      });
    }
    for (const change of scenario.paragraphFormats ?? []) {
      const textTarget = Object.values(doc.elements)
        .find((record) => record.src.name === change.targetName);
      if (!textTarget) throw new Error(`M1 指纹固件缺少段落格式目标：${change.targetName}`);
      editor.exec({
        type: 'SetParaProps', id: textTarget.id,
        ...(change.cell ? { cell: change.cell } : {}), range: change.range, props: change.props,
      });
    }
  } else if (scenario.type === 'bodyProps') {
    for (const change of scenario.changes) {
      const bodyTarget = Object.values(doc.elements)
        .find((record) => record.src.name === change.targetName);
      if (!bodyTarget) throw new Error(`M1 指纹固件缺少文字框目标：${change.targetName}`);
      editor.exec({ type: 'SetBodyProps', id: bodyTarget.id, props: change.props });
    }
  } else if (scenario.type === 'insertRow') {
    const rowTarget = target?.src.kind === 'table' ? target
      : Object.values(doc.elements).find((record) => record.src.kind === 'table');
    if (!rowTarget) throw new Error('M1 指纹固件缺少追加行表格');
    editor.exec({ type: 'InsertRow', id: rowTarget.id });
    const row = editor.effectiveElement(rowTarget.id).rows.length - 1;
    editor.exec({
      type: 'EditText', id: rowTarget.id, cell: { r: row, c: scenario.cell ?? 0 },
      ops: [{
        type: 'replace', from: { p: 0, r: 0, off: 0 },
        to: { p: 0, r: 0, off: 0 }, text: scenario.text,
      }],
    });
  } else if (scenario.type === 'addShape') {
    editor.exec({
      type: 'AddShape', slideId: doc.slideOrder[slideIndex], preset: scenario.preset, rect: scenario.rect,
    });
    const id = editor.selection.kind === 'elements' ? editor.selection.ids[0] : null;
    if (!id) throw new Error('M1 指纹未得到新增形状选区');
    editor.exec({
      type: 'EditText', id,
      ops: [{
        type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 }, text: scenario.text,
      }],
    });
  } else if (scenario.type === 'addImage') {
    for (const image of scenario.images) {
      const imageBytes = image.part
        ? pres.package.parts[image.part]
        : Uint8Array.from(Buffer.from(image.base64, 'base64'));
      editor.exec({
        type: 'AddImage', slideId: doc.slideOrder[slideIndex],
        bytes: imageBytes, mime: image.mime, rect: image.rect,
      });
    }
  } else if (scenario.type === 'addTable') {
    const placeholder = Object.values(doc.elements).find((record) =>
      record.src.name === scenario.placeholderName);
    editor.exec({
      type: 'AddTable', slideId: doc.slideOrder[slideIndex], rows: scenario.rows,
      cols: scenario.cols, rect: scenario.rect, placeholderId: placeholder.id,
    });
    const id = editor.selection.kind === 'elements' ? editor.selection.ids[0] : null;
    for (const change of scenario.edits) editor.exec({
      type: 'EditText', id, cell: change.cell,
      ops: [{
        type: 'replace', from: { p: 0, r: 0, off: 0 },
        to: { p: 0, r: 0, off: 0 }, text: change.text,
      }],
    });
    editor.exec({ type: 'InsertRow', id });
    editor.exec({
      type: 'EditText', id, cell: { r: scenario.rows, c: scenario.cols - 1 },
      ops: [{
        type: 'replace', from: { p: 0, r: 0, off: 0 },
        to: { p: 0, r: 0, off: 0 }, text: scenario.appendedText,
      }],
    });
    if (scenario.transform) editor.exec({ type: 'SetXfrm', id, ...scenario.transform });
  } else if (scenario.type === 'addSlide') {
    const layout = (name) => doc.layoutOrder.find((id) => doc.layouts[id].name === name);
    const first = doc.slideOrder[0];
    const titleResult = editor.exec({
      type: 'AddSlide', layoutId: layout(scenario.titleLayoutName), at: { after: first },
    });
    const titleSlide = [...titleResult.createdSlides][0];
    const title = doc.slides[titleSlide].children.map((id) => doc.elements[id])
      .find((record) => record.meta.ph?.type === 'title');
    editor.exec({
      type: 'EditText', id: title.id,
      ops: [{
        type: 'replace', from: { p: 0, r: 0, off: 0 },
        to: { p: 0, r: 0, off: 0 }, text: scenario.text,
      }],
    });
    editor.exec({
      type: 'AddSlide', layoutId: layout(scenario.blankLayoutName), at: { after: titleSlide },
    });
  } else if (scenario.type === 'moveSlide') {
    const slideByPart = (part) => doc.slideOrder.find((id) => doc.slides[id].origin?.part === part);
    for (const move of scenario.moves) editor.exec({
      type: 'MoveSlide', id: slideByPart(move.part),
      at: { after: move.afterPart === null ? null : slideByPart(move.afterPart) },
    });
  } else if (!target) throw new Error('M1 指纹固件缺少编辑目标');
  else if (scenario.type === 'remove') editor.exec({ type: 'RemoveElement', id: target.id });
  else if (scenario.type === 'order') editor.exec({ type: 'SetZ', id: target.id, to: scenario.to });
  else if (scenario.type === 'align') {
    const ids = scenario.targetNames.map((name) => Object.values(doc.elements)
      .find((record) => record.src.name === name)?.id);
    if (ids.some((id) => !id)) throw new Error('M1 指纹固件缺少对齐目标');
    editor.exec({ type: 'AlignElements', ids, edge: scenario.edge });
  }
  else editor.exec({ type: 'SetXfrm', id: target.id, x: scenario.x });
  slide = editor.toSlide(doc.slideOrder[slideIndex]);
}

// blob:/asset: 都是解析会话身份；指纹比较必须先内联同一资源字节，才是在比视觉投影。
const inlineAssets = (value) => {
  if (typeof value === 'string') {
    const asset = pres.package?.assets?.[value];
    if (!asset) return value;
    return `data:${asset.mime};base64,${Buffer.from(asset.bytes).toString('base64')}`;
  }
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(inlineAssets);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, inlineAssets(child)]));
};
slide = inlineAssets(slide);

const fingerprints = {};
for (const textMode of ['html', 'svg']) {
  const svg = core.renderSlideToSvg(pres, slide, { textMode, idPrefix: `m1-${textMode}-` });
  fingerprints[textMode] = `${svg.length}:${createHash('sha256').update(svg).digest('hex')}`;
}
if (doc) edit.disposeDoc(doc);
else pres.dispose?.();
process.stdout.write(JSON.stringify(fingerprints));
