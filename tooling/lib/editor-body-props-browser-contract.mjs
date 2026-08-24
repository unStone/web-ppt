const percentile95 = (samples) => [...samples]
  .sort((left, right) => left - right)[Math.floor(samples.length * 0.95)];

function frameError(mount, session, record) {
  const element = session.editor.effectiveElement(record.id);
  const partition = mount.querySelector(`[data-edit-id="${record.id}"]`);
  const base = partition?.querySelector(':scope > g[transform]');
  const outline = mount.querySelector('[data-edit-selection-frame]');
  const targetMatrix = base?.getScreenCTM();
  const overlayMatrix = outline?.getScreenCTM();
  if (!targetMatrix || !overlayMatrix) throw new Error('文字框属性无法取得静态形状或选框矩阵');
  const expected = [[0, 0], [element.w, 0], [element.w, element.h], [0, element.h]]
    .map(([x, y]) => new DOMPoint(x, y).matrixTransform(targetMatrix));
  const actual = outline.getAttribute('points').trim().split(/\s+/).map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    return new DOMPoint(x, y).matrixTransform(overlayMatrix);
  });
  return Math.max(...actual.map((point, index) =>
    Math.hypot(point.x - expected[index].x, point.y - expected[index].y)));
}

async function measure({ openEditor, bytes, textMode }) {
  const session = await openEditor(bytes, { idPrefix: `browser-body-props-${textMode}-` });
  const record = Object.values(session.editor.doc.elements)
    .find((candidate) => candidate.src.name === '文字方向-水平');
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  const view = session.mount(mount, { mode: 'edit', textMode });
  mount.querySelector(`[data-edit-id="${record.id}"]`).dispatchEvent(
    new MouseEvent('dblclick', { bubbles: true, composed: true, cancelable: true }),
  );
  const samples = [];
  let synchronous = true;
  let maxFrameError = 0;
  const failures = new Set();
  const anchors = ['top', 'middle', 'bottom'];
  const directions = ['horz', 'vert', 'vert270', 'wordArtVert'];
  const modes = ['none', 'normal', 'shape'];
  for (let index = 0; index < 80; index++) {
    const props = {
      anchor: anchors[index % anchors.length],
      insets: [2 + index % 4, 3 + index % 5, 4 + index % 3, 5 + index % 6],
      wrap: index % 2 === 0,
      vert: directions[index % directions.length],
      anchorCtr: index % 2 === 1,
      columns: index % 2 + 1,
      columnGap: 8 + index % 9,
      autoFit: modes[index % modes.length],
    };
    const partition = mount.querySelector(`[data-edit-id="${record.id}"]`);
    const editable = mount.querySelector('[data-ppt-text-editor]');
    const started = performance.now();
    const accepted = view.setBodyProps(props);
    const nextPartition = mount.querySelector(`[data-edit-id="${record.id}"]`);
    const nextEditable = mount.querySelector('[data-ppt-text-editor]');
    nextPartition.getBoundingClientRect();
    const error = frameError(mount, session, record);
    samples.push(performance.now() - started);
    maxFrameError = Math.max(maxFrameError, error);
    const queried = view.queryBodyProps();
    const checks = {
      accepted,
      partition: nextPartition !== partition,
      editable: nextEditable !== editable,
      selection: session.editor.selection.kind === 'text',
      anchor: queried.anchor === props.anchor,
      wrap: queried.wrap === props.wrap,
      vert: queried.vert === props.vert,
      anchorCtr: queried.anchorCtr === props.anchorCtr,
      columns: queried.columns === props.columns,
      columnGap: queried.columnGap === props.columnGap,
      autoFit: queried.autoFit === props.autoFit,
      editorMode: !!nextEditable.querySelector(`[data-autofit="${props.autoFit}"]`),
      frame: error <= 0.5,
    };
    for (const [name, passed] of Object.entries(checks)) {
      if (!passed) failures.add(name === 'partition' ? `partition@${index}` : name);
    }
    synchronous &&= Object.values(checks).every(Boolean);
  }
  const result = { p95: percentile95(samples), synchronous, frameError: maxFrameError, failures: [...failures] };
  view.destroy();
  session.dispose();
  mount.remove();
  return result;
}

export async function runEditorBodyPropsBrowserContract({ openEditor, load }) {
  const bytes = await load('sample-editor-body-props.pptx');
  const browser = await measure({ openEditor, bytes: bytes.slice(0), textMode: 'html' });
  const engine = await measure({ openEditor, bytes: bytes.slice(0), textMode: 'svg' });
  for (const [mode, result] of Object.entries({ browser, engine })) {
    if (!result.synchronous || result.p95 > 30 || result.frameError > 0.5) {
      throw new Error(`${mode} 文字框属性失败：p95=${result.p95.toFixed(3)}ms `
        + `同步=${result.synchronous}/${result.failures.join(',')} frame=${result.frameError.toFixed(3)}px`);
    }
  }
  return {
    browserP95: browser.p95,
    engineP95: engine.p95,
    frameError: Math.max(browser.frameError, engine.frameError),
  };
}
