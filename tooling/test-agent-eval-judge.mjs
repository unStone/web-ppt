import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parse } from '@web-ppt/core';
import { createDoc, disposeDoc, Editor, effectiveElement, textBodyEditText, textPositionAtIndex } from '@web-ppt/edit-core';
import { patchOpcPackage, disposeOpcPackage } from '@web-ppt/edit-core/opc';
import { LAYOUT_CHECKS } from '@web-ppt/edit-core/lint';
import { makePng } from './lib/ooxml.mjs';
import { TASKS } from './agent-eval/tasks.mjs';
import { buildFixture, buildReferenceSolution } from './agent-eval/fixtures.mjs';
import { createRuntime } from './agent-eval/runtime.mjs';
import { assertJudgeRuntime, judgeTask } from './agent-eval/judge.mjs';

async function mutate(bytes, action) {
  const pres = await parse(bytes, { edit: true, keepPackage: true, lazy: false });
  const doc = createDoc(pres, { idPrefix: 'eval-mutant-' });
  const editor = new Editor(doc);
  const named = name => {
    const matches = Object.values(doc.elements).filter(record => record.src.name === name);
    assert.equal(matches.length, 1, name);
    return matches[0].id;
  };
  const range = id => {
    const body = effectiveElement(doc, id).text;
    return { from: { p: 0, r: 0, off: 0 }, to: textPositionAtIndex(body, textBodyEditText(body).length) };
  };
  try {
    await action({ doc, editor, named, range });
    return new Uint8Array(await editor.save());
  } finally {
    editor.dispose();
    disposeDoc(doc);
  }
}

async function patch(bytes, action) {
  const pres = await parse(bytes, { edit: true, keepPackage: true, lazy: false });
  let result;
  try {
    result = patchOpcPackage(pres.package, action(pres.package.parts));
    return new Uint8Array(result.bytes);
  } finally {
    if (result) disposeOpcPackage(result.package);
    pres.dispose?.();
  }
}

async function xmlPatch(bytes, action) {
  return patch(bytes, parts => {
    const part = 'ppt/slides/slide1.xml';
    const dom = new JSDOM(parts[part], { contentType: 'application/xml' });
    try {
      action(dom.window.document);
      return { [part]: new TextEncoder().encode(new dom.window.XMLSerializer().serializeToString(dom.window.document)) };
    } finally { dom.window.close(); }
  });
}

for (const task of TASKS) {
  test(`${task.id} 正确参考真实重开后完整七项通过`, async () => {
    const result = await judgeTask({ taskId: task.id, inputBytes: buildFixture(task.id),
      outputBytes: buildReferenceSolution(task.id) });
    assert.equal(result.pass, true, JSON.stringify(result.failures));
    assert.deepEqual(result.failures, []);
    assert.equal(result.lint.status, 'ok');
    assert.deepEqual(result.lint.report.checks, [...LAYOUT_CHECKS]);
    assert.deepEqual(result.lint.report.issues, []);
    assert.deepEqual(result.lint.failures, []);
  });
  test(`${task.id} 原输入不能冒充完成产物`, async () => {
    const inputBytes = buildFixture(task.id);
    const result = await judgeTask({ taskId: task.id, inputBytes, outputBytes: inputBytes });
    assert.equal(result.pass, false);
    assert(result.failures.some(item => item.reason === 'title-mismatch'));
  });
  test(`${task.id} 生产编辑命令实际修复后可通过`, async () => {
    const inputBytes = buildFixture(task.id);
    const outputBytes = await mutate(inputBytes, ({ editor, named, range }) => {
      const title = named(task.titleName);
      editor.exec({ type: 'EditText', id: title, ops: [{ type: 'replace', ...range(title), text: task.expectedTitle }] });
      if (task.kind === 'text-overflow') editor.exec({ type: 'SetXfrm', id: named('Evaluation body'), h: 250 });
      if (['element-overlap', 'off-canvas'].includes(task.kind)) {
        editor.exec({ type: 'SetXfrm', id: named('Evaluation card'), x: 460, y: 320 });
      }
      if (task.kind === 'low-contrast') editor.exec({ type: 'SetRunProps', id: title,
        range: range(title), props: { color: '#202020' } });
      if (task.kind === 'missing-font') editor.exec({ type: 'SetRunProps', id: title,
        range: range(title), props: { font: task.fontFamily } });
      if (task.kind === 'image-distorted') editor.exec({ type: 'SetXfrm', id: named('Evaluation image'), h: 90 });
    });
    const result = await judgeTask({ taskId: task.id, inputBytes, outputBytes });
    assert.equal(result.pass, true, JSON.stringify(result.failures));
    assert.equal(result.lint.status, 'ok');
  });
}

const taskId = 'case-01';
const inputBytes = buildFixture(taskId);
const reference = buildReferenceSolution(taskId);
const candidates = [
  ['隐藏页面', 'visibility-changed', ({ doc, editor }) => editor.exec({ type: 'SetHidden', id: doc.slideOrder[0], v: true })],
  ['删除图片', 'element-structure-changed', ({ editor, named }) => editor.exec({ type: 'RemoveElement', id: named('Evaluation image') })],
  ['增加对象', 'element-structure-changed', ({ doc, editor }) => editor.exec({ type: 'AddShape', slideId: doc.slideOrder[0], preset: 'rect', rect: { x: 5, y: 5, w: 10, h: 10 } })],
  ['删减正文', 'text-content-changed', ({ editor, named, range }) => {
    const id = named('Evaluation body');
    editor.exec({ type: 'EditText', id, ops: [{ type: 'replace', ...range(id), text: 'Short body' }] });
  }],
  ['不可读字号', 'text-too-small', ({ editor, named, range }) => {
    const id = named('Evaluation body');
    editor.exec({ type: 'SetRunProps', id, range: range(id), props: { size: 1 } });
  }],
  ['透明正文', 'protected-native-format-changed', ({ editor, named, range }) => {
    const id = named('Evaluation body');
    editor.exec({ type: 'SetRunProps', id, range: range(id), props: { color: 'rgba(0,0,0,0)' } });
  }],
  ['半透明正文', 'protected-native-format-changed', ({ editor, named, range }) => {
    const id = named('Evaluation body');
    editor.exec({ type: 'SetRunProps', id, range: range(id), props: { color: 'rgba(0,0,0,.8)' } });
  }],
  ['修改未授权粗体格式', 'protected-format-changed', ({ editor, named, range }) => {
    const id = named('Evaluation body');
    editor.exec({ type: 'SetRunProps', id, range: range(id), props: { b: true } });
  }],
  ['将矩形等价转换为自由几何', 'protected-native-format-changed', ({ editor, named }) => editor.exec({
    type: 'ConvertToCustomGeometry', id: named('Evaluation card'),
  })],
  ['修改图片裁剪', 'image-content-changed', ({ editor, named }) => editor.exec({ type: 'SetCrop', id: named('Evaluation image'), crop: { l: .25, t: 0, r: 0, b: 0 } })],
  ['缩成微小图片', 'image-too-small', ({ editor, named }) => editor.exec({ type: 'SetXfrm', id: named('Evaluation image'), w: 2, h: 1 })],
  ['修改主题', 'package-content-changed', ({ doc, editor }) => editor.exec({ type: 'SetTheme', id: doc.themeOrder[0], clrScheme: { accent1: '#ff0000' } })],
];
for (const [name, reason, change] of candidates) {
  test(`${name} 不得伪通过`, async () => {
    const result = await judgeTask({ taskId, inputBytes, outputBytes: await mutate(reference, change) });
    assert.equal(result.pass, false, name);
    assert(result.failures.some(item => item.reason === reason), JSON.stringify(result.failures));
  });
}

test('原生对象hidden属性不能被解析投影忽略而伪通过', async () => {
  const outputBytes = await patch(reference, parts => {
    const part = 'ppt/slides/slide1.xml';
    const dom = new JSDOM(parts[part], { contentType: 'application/xml' });
    try {
      const properties = [...dom.window.document.getElementsByTagNameNS(
        'http://schemas.openxmlformats.org/presentationml/2006/main', 'cNvPr')]
        .find(element => element.getAttribute('name') === 'Evaluation body');
      assert(properties);
      properties.setAttribute('hidden', '1');
      return { [part]: new TextEncoder().encode(new dom.window.XMLSerializer().serializeToString(dom.window.document)) };
    } finally { dom.window.close(); }
  });
  const result = await judgeTask({ taskId, inputBytes, outputBytes });
  assert.equal(result.pass, false);
  assert(result.failures.some(item => item.reason === 'visibility-changed'));
});

const presentationNs = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const drawingNs = 'http://schemas.openxmlformats.org/drawingml/2006/main';
function nativeObject(document, name) {
  const property = [...document.getElementsByTagNameNS(presentationNs, 'cNvPr')]
    .find(element => element.getAttribute('name') === name);
  assert(property, name);
  return property.parentElement.parentElement;
}
for (const [name, change] of [
  ['合法show=false隐藏页面', document => document.documentElement.setAttribute('show', 'false')],
  ['标题bodyPr旋转90度', document => nativeObject(document, 'Evaluation title')
    .getElementsByTagNameNS(drawingNs, 'bodyPr')[0].setAttribute('rot', '5400000')],
  ['正文bodyPr旋转180度', document => nativeObject(document, 'Evaluation body')
    .getElementsByTagNameNS(drawingNs, 'bodyPr')[0].setAttribute('rot', '10800000')],
  ['非法原生EMU坐标', document => nativeObject(document, 'Evaluation body')
    .getElementsByTagNameNS(drawingNs, 'off')[0].setAttribute('x', 'not-a-coordinate')],
  ['文字alphaMod=0隐藏正文', document => {
    const color = nativeObject(document, 'Evaluation body').getElementsByTagNameNS(drawingNs, 'srgbClr')[0];
    const modifier = document.createElementNS(drawingNs, 'a:alphaMod');
    modifier.setAttribute('val', '0'); color.append(modifier);
  }],
  ['图片alphaInv隐藏原图', document => {
    const blip = nativeObject(document, 'Evaluation image').getElementsByTagNameNS(drawingNs, 'blip')[0];
    blip.append(document.createElementNS(drawingNs, 'a:alphaInv'));
  }],
  ['文字noFill隐藏正文', document => {
    const run = nativeObject(document, 'Evaluation body').getElementsByTagNameNS(drawingNs, 'rPr')[0];
    run.getElementsByTagNameNS(drawingNs, 'solidFill')[0].remove();
    run.append(document.createElementNS(drawingNs, 'a:noFill'));
  }],
]) {
  test(`${name} 不得被投影丢弃而伪通过`, async () => {
    const result = await judgeTask({ taskId, inputBytes, outputBytes: await xmlPatch(reference, change) });
    assert.equal(result.pass, false);
    assert.equal(result.lint.report, null);
  });
}

test('孤立原图不能掩盖实际引用图片被替换', async () => {
  const outputBytes = await patch(reference, parts => ({
    'ppt/media/evaluation.png': makePng(80, 40, () => [255, 0, 0]),
    'ppt/media/orphan-original.png': parts['ppt/media/evaluation.png'],
  }));
  const result = await judgeTask({ taskId, inputBytes, outputBytes });
  assert.equal(result.pass, false);
  assert(result.failures.some(item => item.reason === 'image-content-changed'));
});

test('关系指向的图片字节缺失不得通过', async () => {
  const outputBytes = await patch(reference, () => ({ 'ppt/media/evaluation.png': null }));
  const result = await judgeTask({ taskId, inputBytes, outputBytes });
  assert.equal(result.pass, false);
  assert(result.failures.some(item => ['image-content-changed', 'output-parse-failed'].includes(item.reason)));
});

test('错误输入基线不得被用来掩盖内容修改', async () => {
  await assert.rejects(judgeTask({ taskId, inputBytes: reference, outputBytes: reference }), /input.*hash|输入.*哈希/);
});

test('损坏候选明确失败且没有完整lint报告', async () => {
  const result = await judgeTask({ taskId, inputBytes, outputBytes: new Uint8Array([1, 2, 3]) });
  assert.equal(result.pass, false);
  assert.equal(result.lint.report, null);
  assert(result.failures.some(item => item.reason === 'output-parse-failed'));
});

test('测量、采样、字体库存或检查项缺失时判定器运行时失败', () => {
  const runtime = createRuntime();
  assertJudgeRuntime(runtime, TASKS[0]);
  for (const invalid of [
    { ...runtime, measureText: undefined },
    { ...runtime, rasterize: undefined },
    { ...runtime, lint: { ...runtime.lint, checks: ['off-canvas'] } },
    { ...runtime, lint: { ...runtime.lint, resolveContrast: undefined } },
    { ...runtime, lint: { ...runtime.lint, fonts: { available: [], embedded: [] } } },
  ]) assert.throws(() => assertJudgeRuntime(invalid, TASKS[0]), /runtime|运行时/);
});

test('真实normal autofit可保留且实际字号仍须达标', async () => {
  const outputBytes = await mutate(reference, ({ editor, named }) => editor.exec({
    type: 'SetBodyProps', id: named('Evaluation body'), props: { autoFit: 'normal' },
  }));
  const result = await judgeTask({ taskId, inputBytes, outputBytes });
  assert.equal(result.pass, true, JSON.stringify(result.failures));
});

test('normal autofit实际缩小后仍清晰的候选允许通过', async () => {
  const outputBytes = await mutate(reference, ({ editor, named }) => {
    const id = named('Evaluation body');
    editor.exec({ type: 'SetXfrm', id, h: 150 }, { type: 'SetBodyProps', id, props: { autoFit: 'normal' } });
  });
  const result = await judgeTask({ taskId, inputBytes, outputBytes });
  assert.equal(result.pass, true, JSON.stringify(result.failures));
});

test('normal autofit不能把实际字号压到12px以下伪通过', async () => {
  const outputBytes = await mutate(reference, ({ editor, named }) => {
    const id = named('Evaluation body');
    editor.exec({ type: 'SetXfrm', id, h: 15 }, { type: 'SetBodyProps', id, props: { autoFit: 'normal' } });
  });
  const result = await judgeTask({ taskId, inputBytes, outputBytes });
  assert.equal(result.pass, false);
  assert(result.failures.some(item => item.reason === 'text-too-small'));
});

test('允许改变的几何仍须经过完整七项检查', async () => {
  const outputBytes = await mutate(reference, ({ editor, named }) => editor.exec({
    type: 'SetXfrm', id: named('Evaluation card'), x: 650,
  }));
  const result = await judgeTask({ taskId, inputBytes, outputBytes });
  assert.equal(result.pass, false);
  assert.equal(result.lint.status, 'ok');
  assert.deepEqual(result.lint.report.checks, [...LAYOUT_CHECKS]);
  assert(result.lint.report.issues.some(item => item.reason === 'off-canvas'));
});

test('复杂遮挡采样能力不足必须显式失败而不是空报告', async () => {
  const outputBytes = await mutate(reference, ({ editor, named }) => editor.exec({
    type: 'SetXfrm', id: named('Evaluation card'), x: 80, y: 130,
  }));
  const result = await judgeTask({ taskId, inputBytes, outputBytes });
  assert.equal(result.pass, false);
  assert.equal(result.lint.status, 'failed');
  assert.equal(result.lint.report, null);
  assert.equal(result.lint.failures[0].reason, 'eval-contrast-background-unsupported');
});

test('未知SDK读取依赖错误不能归咎于模型候选文件', async () => {
  const { stdout } = await promisify(execFile)(process.execPath,
    ['--experimental-test-module-mocks', fileURLToPath(new URL('./lib/agent-eval-judge-read-fault.mjs', import.meta.url))]);
  assert(stdout.includes('未冒充模型输出错误'));
});

test('等价的不透明alpha默认值不会误拒', async () => {
  const outputBytes = await xmlPatch(reference, document => {
    const color = nativeObject(document, 'Evaluation body').getElementsByTagNameNS(drawingNs, 'srgbClr')[0];
    const alpha = document.createElementNS(drawingNs, 'a:alpha');
    alpha.setAttribute('val', '100000'); color.append(alpha);
  });
  const result = await judgeTask({ taskId, inputBytes, outputBytes });
  assert.equal(result.pass, true, JSON.stringify(result.failures));
});

test('等价的零图片裁剪不会误拒', async () => {
  const outputBytes = await mutate(reference, ({ editor, named }) => editor.exec({
    type: 'SetCrop', id: named('Evaluation image'), crop: { l: 0, t: 0, r: 0, b: 0 },
  }));
  const result = await judgeTask({ taskId, inputBytes, outputBytes });
  assert.equal(result.pass, true, JSON.stringify(result.failures));
});
