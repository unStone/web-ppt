import { openEditor } from '@web-ppt/editor';
import * as adjustments from '@web-ppt/editor/adjustments';
import { bindCollaboration } from '@web-ppt/collab';
import { createEditorApplication } from '../../packages/site/src/editor-application';
import { languageReady } from '../../packages/site/src/i18n/runtime';
import { deferred, fakeModelContext } from './site-webmcp-platform.mjs';

export async function runWebMcpContract() {
  await languageReady;
  let assertions = 0;
  const check = (condition, message) => { if (!condition) throw new Error(message); assertions++; };
  const bytes = await fetch('/fixtures/sample-agent-webmcp.pptx').then(response => response.arrayBuffer());
  const original = Object.getOwnPropertyDescriptor(document, 'modelContext');
  const nativeApi = typeof document.modelContext?.registerTool === 'function';
  const platform = fakeModelContext();
  const notices = [], state = { session: null, view: null, writable: true, name: 'webmcp.pptx' };
  const snapshot = () => ({ ...state, adjustments: null,
    writable: state.writable && state.view?.mode !== 'view' && !state.session?.editor.doc.meta.readonly });
  const host = { canvas: document.querySelector('#canvasMount'), objects: document.querySelector('#objectList'),
    textTools: [], onChange() {}, tools: { snapshot, showSlide() {}, openInspector() {} } };
  const buttons = Object.fromEntries(Object.entries({ save: 'saveFile', saveCopy: 'saveCopyFromMenu', localSave: 'saveToFile',
    saveAs: 'saveAsFile', exportDocument: 'exportDocument', exportImages: 'exportImages' })
    .map(([key, id]) => [key, document.getElementById(id)]));
  const fileHost = { buttons, snapshot: () => ({ ...state, loading: false, showComments: false }), sync() {} };
  const notice = (message, kind) => notices.push({ message, kind });
  const signal = new AbortController().signal;
  let app;
  const create = async () => app = await createEditorApplication(host, notice, fileHost);
  const replace = async (options = {}, viewOptions = {}, openSignal = signal) => {
    state.session = await openEditor(bytes, { idPrefix: 'webmcp-', ...options });
    state.view = null;
    const document = await app.replace(state.session, viewOptions, { adjustments }, openSignal);
    state.view = document?.view ?? null;
    return document;
  };
  const call = async (name, input = {}, invocationSignal = signal) => {
    const tool = platform.tools.get(`ppt_${name}`);
    check(!!tool, `必须注册 ppt_${name}`);
    return tool.execute(input, { signal: invocationSignal });
  };
  const success = async (name, input, invocationSignal) => {
    const result = await call(name, input, invocationSignal);
    check(result.ok, `${name} 执行失败：${JSON.stringify(result)}`);
    return result.value;
  };
  const names = ['describe', 'element', 'lint', 'render', 'edit', 'undo', 'redo', 'save'].map(name => `ppt_${name}`).sort();
  let unsupportedResources;
  try {
    Object.defineProperty(document, 'modelContext', { configurable: true, value: undefined });
    await create();
    await replace();
    const manual = state.session.editor;
    const id = Object.values(manual.doc.elements).find(element => element.src.name === '页面标题').id;
    manual.exec({ type: 'SetName', id, name: '正常手动编辑' });
    check(manual.effectiveElement(id).name === '正常手动编辑', '不支持 WebMCP 时正常手动编辑可用');
    manual.undo();
    check(manual.effectiveElement(id).name === '页面标题', '不支持 WebMCP 时既有撤销行为不变');
    unsupportedResources = performance.getEntriesByType('resource').map(entry => entry.name);
    await app.dispose();
    Object.defineProperty(document, 'modelContext', { configurable: true, value: platform });
    await create();
    await replace();
    check(JSON.stringify([...platform.tools.keys()].sort()) === JSON.stringify(names), '当前文稿必须注册八个工具');
    const description = await success('describe', {});
    const title = description.slides[0].elements.find(element => element.name === '页面标题');
    const overflow = description.slides[0].elements.find(element => element.name === '溢出文本');
    const picture = description.slides[0].elements.find(element => element.name === '替换图片');
    check(!!title && !!overflow && !!picture, '复用本机 MCP 的三种真实对象固件');
    for (const tool of platform.tools.values()) {
      check(tool.inputSchema.type === 'object' && !tool.inputSchema.$ref, `${tool.name} Schema 根必须为对象`);
    }
    const editor = state.session.editor;
    const messages = [];
    const collab = bindCollaboration(editor, { documentId: 'webmcp-contract', replicaId: 'browser', replicaSlot: 1,
      provider: { send: message => messages.push(message), subscribe: () => () => {} } });
    try {
      const before = JSON.stringify({ doc: editor.doc, undo: editor.history.undoEntries });
      const invalid = await call('edit', { commands: [{ type: 'SetName', id: title.id, name: '非法', extra: true }] });
      check(!invalid.ok && invalid.error.reason === 'invalid-input', '非法参数必须明确拒绝');
      check(JSON.stringify({ doc: editor.doc, undo: editor.history.undoEntries }) === before, '非法参数不能改变文稿与历史');
      const edited = await success('edit', { commands: [
        { type: 'SetName', id: title.id, name: 'WebMCP 标题' },
        { type: 'ReplaceText', scope: { kind: 'document' }, from: '可编辑', to: '浏览器原生' },
      ], lint: { checks: ['off-canvas'] } });
      check(edited.history.undoCount === 1 && editor.history.undoCount === 1, 'Agent 批量修改必须复用同一历史事务');
      check(messages.length === 1 && messages[0].patches.some(patch => patch.path?.[1] === title.id), '真实协同绑定必须观察到 Agent 补丁');
      const after = await success('describe', {});
      check(after.slides[0].elements.find(element => element.id === title.id).paragraphs.some(p => p.text.includes('浏览器原生')), '批量替换必须作用于当前文稿');
      check(after.slides[1].elements.some(element => element.paragraphs?.some(p => p.text.includes('浏览器原生'))), '全稿替换必须覆盖第二页');
      await success('undo', {});
      check(editor.effectiveElement(title.id).name === '页面标题', 'Agent 撤销必须作用于宿主编辑历史');
      editor.redo();
      check(editor.effectiveElement(title.id).name === 'WebMCP 标题', '手动重做必须重放 Agent 事务');
      const overflowBefore = await success('lint', { checks: ['text-overflow'] });
      check(overflowBefore.issues.some(issue => issue.elementId === overflow.id && issue.reason === 'text-overflow'), '真实浏览器测量必须发现固件溢出');
      await success('edit', { commands: [{ type: 'SetXfrm', id: overflow.id, w: 500, h: 160 }] });
      const overflowAfter = await success('lint', { checks: ['text-overflow'] });
      check(!overflowAfter.issues.some(issue => issue.elementId === overflow.id && issue.reason === 'text-overflow'), '扩大文本框后必须消除溢出');
      const replacement = new Uint8Array(await fetch('/fixtures/agent-mcp-replacement.png').then(response => response.arrayBuffer()));
      const originalImage = editor.effectiveElement(picture.id).src;
      await success('edit', { commands: [{ type: 'ReplaceImage', id: picture.id,
        bytes: btoa(String.fromCharCode(...replacement)), mime: 'image/png' }] });
      check(editor.effectiveElement(picture.id).src !== originalImage, '图片替换必须写入真实资源');
      const imageBytes = new Uint8Array(await fetch(editor.effectiveElement(picture.id).src).then(response => response.arrayBuffer()));
      check(imageBytes.length === replacement.length && imageBytes.every((byte, index) => byte === replacement[index]),
        '替换后的资源必须与调用方提供的图片逐字节一致');
    } finally { collab.dispose(); }
    const style = await success('element', { id: title.id, query: 'fill' });
    check(style.id === title.id, '样式读取必须定位当前稳定元素');
    const svg = await success('render', { slideNumber: 1, format: 'svg' });
    check(svg.data.includes('<svg') && !svg.data.includes('foreignObject') && !svg.data.includes('blob:'),
      'SVG 渲染必须使用可移植原生文字并内联文稿资源');
    const png = await success('render', { slideNumber: 1, format: 'png', scale: .5 });
    const pngBytes = Uint8Array.from(atob(png.data), char => char.charCodeAt(0));
    check(pngBytes[0] === 137 && pngBytes[1] === 80, 'PNG 必须产生真实图片字节');
    const decoded = await createImageBitmap(new Blob([pngBytes], { type: 'image/png' }));
    try { check(decoded.width === 320 && decoded.height === 180, 'PNG 必须可真实解码且遵循 .5 倍缩放'); }
    finally { decoded.close(); }
    await testDownloads({ app, state, call, success, check, title, signal });
    await testFileTasks({ app, state, replace, check, call, title, bytes });
    const stale = platform.tools.get('ppt_edit').execute;
    const oldSession = state.session;
    await replace();
    const refused = await stale({ commands: [{ type: 'SetName', id: title.id, name: '过期修改' }] }, { signal });
    check(!refused.ok && refused.error.reason === 'aborted' && oldSession.disposed, '换稿后旧回调必须拒绝，旧文稿已释放');
    check(platform.tools.size === 8, '切换后仅保留一份注册');
    state.writable = false;
    const locked = await call('edit', { commands: [{ type: 'SetName', id: title.id, name: '只读修改' }] });
    check(!locked.ok && locked.error.reason === 'document-not-writable', '只读宿主必须拒绝写入');
    state.writable = true;
    state.view.setMode('view');
    const viewing = await call('edit', { commands: [{ type: 'SetName', id: title.id, name: '查看态修改' }] });
    check(!viewing.ok && viewing.error.reason === 'document-not-writable', '查看模式必须拒绝写入');
    state.view.setMode('edit');
    const closingCallback = platform.tools.get('ppt_describe').execute;
    await app.dispose();
    check(platform.tools.size === 0, '关闭必须注销全部工具');
    const closed = await closingCallback({}, { signal });
    check(!closed.ok, '关闭后保留的旧回调必须拒绝');
    await create();
    await replace();
    check(platform.tools.size === 8, '关闭后重新打开必须完整注册');
    await app.dispose();
    check(platform.tools.size === 0, '重开应用退出也必须完整注销');
    await create();
    const recoveryOptions = app.recovery.openOptions(signal).recovery;
    await replace({ recovery: { ...recoveryOptions, decide: () => 'discard' } });
    await success('edit', { commands: [{ type: 'SetName', id: title.id, name: 'Agent 持久恢复' }] });
    await app.recovery.flush(state.session);
    check(state.session.recovery.pending === 0 && !state.session.recovery.error, 'Agent 改动必须写入真实 IndexedDB 恢复日志');
    await app.dispose();
    await create();
    const restoring = app.recovery.openOptions(signal).recovery;
    let offered = 0;
    await replace({ recovery: { ...restoring, decide() { offered++; return 'restore'; } } });
    check(offered === 1 && state.session.editor.effectiveElement(title.id).name === 'Agent 持久恢复',
      '关闭应用并重开 IndexedDB 必须恢复 Agent 改动');
    await restoring.store.remove(state.session.recovery.source);
    await app.dispose();
    await create();
    platform.failAt(3);
    try { await replace(); check(false, '平台注册失败必须传播'); }
    catch (error) { check(String(error).includes('验收模拟平台注册失败'), '注册失败必须保留平台错误'); }
    check(platform.tools.size === 0 && state.session.disposed, '部分注册失败必须注销已注册工具并释放失败会话');
    platform.failAt(-1);
    const registrationGate = deferred(), enteredRegistration = deferred(), openingSignal = new AbortController();
    platform.hold({ promise: registrationGate.promise, entered: enteredRegistration });
    const loading = replace({}, {}, openingSignal.signal);
    await enteredRegistration.promise;
    openingSignal.abort(); registrationGate.resolve();
    check(await loading === undefined, '注册途中取消必须返回过期打开结果');
    check(platform.tools.size === 0 && state.session.disposed, '取消注册必须回收工具与文稿');
    platform.hold(null);
    await replace();
    check(platform.tools.size === 8, '注册失败及取消后必须能重试');
    await testReplacementCancellation({ app, state, bytes, check, call, platform, replace });
    await testFontWaitCancellation({ app, state, replace, check, call });
    await testPngCancellation({ app, state, replace, check, call, platform });
    const finalGate = deferred(), finalReady = deferred();
    const activeTask = app.files.withDocumentTask(state.session, async () => { finalReady.resolve(); await finalGate.promise; });
    await finalReady.promise;
    const finalSession = state.session;
    let disposed = false;
    const closing = app.dispose().then(() => { disposed = true; });
    await new Promise(resolve => setTimeout(resolve, 20));
    check(!disposed && !finalSession.disposed && platform.tools.size === 0, '退出必须立即注销工具并等待真实活动文件任务');
    finalGate.resolve(); await activeTask; await closing;
    check(finalSession.disposed && !app.files.busy, '文件任务完成后才能完成退出');
    return { ok: true, assertions, nativeApi: nativeApi ? '存在，契约使用注册边界替身' : '不可用，契约使用注册边界替身', unsupportedResources, notices };
  } finally {
    await app?.dispose();
    if (original) Object.defineProperty(document, 'modelContext', original);
    else delete document.modelContext;
  }
}

async function testReplacementCancellation({ app, state, bytes, check, call, platform, replace }) {
  const old = state.session, oldTool = platform.tools.get('ppt_describe');
  const cancelled = new AbortController(); cancelled.abort();
  const rejected = await openEditor(bytes);
  check(await app.replace(rejected, {}, { adjustments }, cancelled.signal) === undefined,
    '入口已取消的替换必须返回过期结果');
  check(rejected.disposed && !old.disposed && platform.tools.get('ppt_describe') === oldTool,
    '入口已取消的替换必须释放候选文稿，并保留当前文稿与原工具');
  const remaining = await call('describe', {});
  check(remaining.ok, '入口已取消后原工具仍然可用');
  const gate = deferred(), ready = deferred();
  const task = app.files.withDocumentTask(old, async () => { ready.resolve(); await gate.promise; });
  await ready.promise;
  const candidate = await openEditor(bytes), stop = new AbortController();
  const replacing = app.replace(candidate, {}, { adjustments }, stop.signal);
  for (let attempt = 0; platform.tools.size && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  check(platform.tools.size === 0 && !old.disposed, '替换开始排空时必须先注销旧工具并保留任务资源');
  stop.abort(); gate.resolve(); await task;
  check(await replacing === undefined, '排空期间取消的替换必须返回过期结果');
  check(old.disposed && candidate.disposed && platform.tools.size === 0,
    '排空期间取消必须完整释放两份文稿，不能遗留无工具的存活旧文稿');
  await replace();
  check(platform.tools.size === 8, '排空期间取消后重新打开必须恢复注册');
}

async function testFileTasks({ app, state, replace, check, call, title, bytes }) {
  check(await app.files.withDocumentTask(state.session, async () => 42) === 42, '文件任务必须返回真实结果');
  try { await app.files.withDocumentTask(state.session, async () => { throw new Error('真实失败'); }); check(false, '任务必须传播失败'); }
  catch (error) { check(error.message === '真实失败', '文件任务不得吞掉失败'); }
  check(!app.files.busy, '失败后必须恢复空闲');
  const detached = await openEditor(bytes);
  try {
    try { await app.files.withDocumentTask(detached, async () => 0); check(false, '未绑定的文稿任务必须拒绝'); }
    catch (error) { check(error.reason === 'document-stale', '未绑定文稿必须明确返回 document-stale'); }
  } finally { detached.dispose(); }
  const gate = deferred(), ready = deferred();
  const pending = app.files.withDocumentTask(state.session, async () => { ready.resolve(); await gate.promise; return 7; });
  await ready.promise;
  check(app.files.busy, '未完成任务必须保持忙碌');
  const historyCount = state.session.editor.history.undoCount;
  const busyEdit = await call('edit', { commands: [{ type: 'SetName', id: title.id, name: '忙碌修改' }] });
  check(!busyEdit.ok && busyEdit.error.reason === 'document-busy' && state.session.editor.history.undoCount === historyCount,
    '文件任务忙碌期间 Agent 写入必须原子拒绝');
  try { await app.files.withDocumentTask(state.session, async () => 0); check(false, '并发文件任务必须拒绝'); }
  catch (error) { check(error.reason === 'document-busy', '忙碌任务必须提供稳定 reason'); }
  const old = state.session;
  const replacing = replace();
  let replaced = false;
  void replacing.then(() => { replaced = true; });
  await new Promise(resolve => setTimeout(resolve, 20));
  check(!replaced && !old.disposed, '切换必须等待真实文件任务');
  gate.resolve();
  check(await pending === 7, '文件任务必须先交付真实结果');
  await replacing;
  check(old.disposed && !app.files.busy, '任务完成后才能释放旧文稿');
  try { await app.files.withDocumentTask(old, async () => 0); check(false, '过期文稿必须拒绝'); }
  catch (error) { check(['session-disposed', 'document-stale'].includes(error.reason), '过期文稿必须给出明确 reason'); }
  const unpause = app.files.pause();
  try { await app.files.withDocumentTask(state.session, async () => 0); check(false, '暂停必须拒绝新任务'); }
  catch (error) { check(error.reason === 'document-busy', '暂停任务必须给出稳定 reason'); }
  finally { unpause(); }
}

async function testFontWaitCancellation({ app, state, replace, check, call }) {
  for (const operation of ['lint', 'render']) {
    const own = Object.getOwnPropertyDescriptor(document.fonts, 'ready');
    const entered = deferred(), gate = deferred();
    Object.defineProperty(document.fonts, 'ready', { configurable: true, get() { entered.resolve(); return gate.promise; } });
    try {
      const reading = call(operation, operation === 'render' ? { slideNumber: 1, format: 'png' } : { checks: ['text-overflow'] });
      await entered.promise;
      const old = state.session;
      await replace();
      const result = await reading;
      check(!result.ok && result.error.reason === 'aborted' && old.disposed,
        `${operation} 等待字体时换稿必须取消旧调用并释放文稿`);
    } finally {
      gate.resolve();
      if (own) Object.defineProperty(document.fonts, 'ready', own);
      else delete document.fonts.ready;
    }
  }
}

async function testPngCancellation({ state, replace, check, call, platform }) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  const entered = deferred(), gate = deferred();
  let released = false;
  Object.defineProperty(HTMLImageElement.prototype, 'src', { ...descriptor, set(value) {
    if (!released && value.startsWith('data:image/svg+xml')) {
      entered.resolve();
      void gate.promise.then(() => descriptor.set.call(this, value));
    } else descriptor.set.call(this, value);
  } });
  try {
    const reading = call('render', { slideNumber: 1, format: 'png' });
    await entered.promise;
    const old = state.session;
    let completed = false;
    const replacing = replace().then(value => { completed = true; return value; });
    await new Promise(resolve => setTimeout(resolve, 20));
    check(platform.tools.size === 0 && !completed && !old.disposed,
      'PNG 已进入不可取消图像解码时，换稿须立即注销并等待真实底层任务');
    released = true; gate.resolve();
    const result = await reading;
    await replacing;
    check(!result.ok && result.error.reason === 'aborted' && old.disposed,
      'PNG 解码收尾后应返回取消，并释放旧文稿资源');
  } finally { released = true; gate.resolve(); Object.defineProperty(HTMLImageElement.prototype, 'src', descriptor); }
}

async function testDownloads({ state, call, success, check, title, signal }) {
  const blobs = new Map(), saved = [];
  const originalCreate = URL.createObjectURL, originalClick = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = function (blob) { const url = originalCreate.call(this, blob); blobs.set(url, blob); return url; };
  HTMLAnchorElement.prototype.click = function () { saved.push({ name: this.download, blob: blobs.get(this.href) }); };
  try {
    const doc = state.session.editor.doc, pageCount = doc.slideOrder.length, layoutId = Object.keys(doc.layouts)[0];
    check(!!layoutId, '固件必须提供可用于新增页面的真实版式');
    await success('edit', { commands: [{ type: 'AddSlide', layoutId, at: { after: doc.slideOrder.at(-1) } }] });
    const newSlide = doc.slideOrder.at(-1);
    check(doc.slideOrder.length === pageCount + 1 && doc.slides[newSlide].layoutId === layoutId,
      '新增页面必须采用指定版式并保留页数');
    const shape = await success('edit', { commands: [{ type: 'AddShape', slideId: newSlide, preset: 'rect',
      rect: { x: 40, y: 30, w: 300, h: 60 } }] });
    const titleId = shape.affectedElements.find(id => doc.elements[id]?.parent === newSlide);
    check(!!titleId, '新页必须创建真实可编辑标题形状');
    await success('edit', { commands: [
      { type: 'SetName', id: titleId, name: 'Agent 新页标题' },
      { type: 'EditText', id: titleId, ops: [{ type: 'replace', from: { p: 0, r: 0, off: 0 },
        to: { p: 0, r: 0, off: 0 }, text: '新增页面的标题' }] },
    ] });
    const addedDescription = await success('describe', {});
    check(addedDescription.slides.at(-1).elements.some(element => element.id === titleId
      && element.paragraphs.some(paragraph => paragraph.text === '新增页面的标题')), '新增页面标题必须可结构化读回');
    await success('edit', { commands: [{ type: 'SetName', id: title.id, name: '下载真实文稿' }] });
    const cancelled = new AbortController(); cancelled.abort();
    const aborted = await call('save', {}, cancelled.signal);
    check(!aborted.ok && aborted.error.reason === 'aborted' && state.session.editor.isDirty() && saved.length === 0,
      '取消下载必须保留 dirty 且不交付文件');
    HTMLAnchorElement.prototype.click = function () { throw new Error('下载交付失败'); };
    const failed = await call('save', {}, signal);
    check(!failed.ok && state.session.editor.isDirty(), '下载失败不能移动保存点');
    HTMLAnchorElement.prototype.click = function () { saved.push({ name: this.download, blob: blobs.get(this.href) }); };
    const downloaded = await success('save', {});
    check(saved.length === 1 && saved[0].blob instanceof Blob && saved[0].name.endsWith('.pptx'), '保存必须实际交付可下载的 Blob');
    check(downloaded.bytes === saved[0].blob.size && !state.session.editor.isDirty(), '保存统计与真实字节匹配，成功后才更新保存点');
    const reopened = await openEditor(saved[0].blob);
    try {
      check(Object.values(reopened.editor.doc.elements).some(element => element.src.name === '下载真实文稿'), '下载文稿必须真实保存并可重开');
      const presentation = reopened.toPresentation();
      check(presentation.slides.length === pageCount + 1 && presentation.slides.at(-1).layoutName === doc.layouts[layoutId].name
        && presentation.slides.at(-1).elements.some(element =>
        element.text?.paragraphs.some(paragraph => paragraph.runs.map(run => run.text).join('') === '新增页面的标题')),
      '新增页面、标题和指定版式必须保存重开');
      check(presentation.slides.slice(0, 2).every(slide => slide.elements.some(element =>
        element.text?.paragraphs.some(paragraph => paragraph.runs.map(run => run.text).join('').includes('浏览器原生')))),
      '两页批量替换必须保存重开');
      const overflow = presentation.slides[0].elements.find(element => element.name === '溢出文本');
      check(overflow.w === 500 && overflow.h === 160, '溢出修复后的外框必须保存重开');
      const image = presentation.slides[0].elements.find(element => element.name === '替换图片');
      const stored = new Uint8Array(await fetch(image.src).then(response => response.arrayBuffer()));
      const expected = new Uint8Array(await fetch('/fixtures/agent-mcp-replacement.png').then(response => response.arrayBuffer()));
      check(stored.length === expected.length && stored.every((byte, index) => byte === expected[index]),
        '图片替换字节必须保存重开');
    }
    finally { reopened.dispose(); }
  } finally { URL.createObjectURL = originalCreate; HTMLAnchorElement.prototype.click = originalClick; }
}
