import { doubleClickAt, doubleClickElement } from './browser-double-click.mjs';

/** 公开挂载 + 固件 + 原生鼠标覆盖捕获后的命中，不用伪造 dblclick 绕过浏览器。 */
export async function runTrustedDoubleClickContract(context) {
  const { evaluate, dispatchKey } = context;
  for (const textMode of ['html', 'svg']) {
    let stage = '挂载';
    await evaluate(`(async () => {
      const { openEditor, load } = globalThis.editorContract;
      const session = await openEditor(await load('sample-edit-basic.pptx'));
      const mount = document.createElement('div'); mount.id = 'native-double-click';
      mount.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:360px;z-index:9999;background:white';
      document.body.append(mount);
      const view = session.mount(mount, { mode: 'edit', textMode: ${JSON.stringify(textMode)}, zoom: .5 });
      const ids = Object.fromEntries(Object.values(session.editor.doc.elements).map((record) => [record.src.name, record.id]));
      const state = { session, view, mount, ids, captures: 0, doubles: 0 };
      view.element.addEventListener('gotpointercapture', (event) => { if (event.isTrusted) state.captures++; });
      view.element.addEventListener('dblclick', (event) => { if (event.isTrusted && event.target === view.element) state.doubles++; });
      globalThis.nativeDoubleClick = state;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`, true);
    const hit = async (name) => {
      stage = name;
      const id = await evaluate(`globalThis.nativeDoubleClick.ids[${JSON.stringify(name)}]`);
      await doubleClickElement(context, `#native-double-click [data-edit-id="${id}"]`);
    };
    const expect = async (condition, label) => {
      stage = label;
      if (!await evaluate(`(() => { const { session, view, mount, ids } = globalThis.nativeDoubleClick;
        return ${condition}; })()`)) throw new Error(`${textMode} 原生双击：${label}`);
    };
    try {
      await hit('普通形状');
      await expect("mount.querySelector('[data-ppt-text-editor]')?.dataset.pptTextEditor === ids['普通形状']", '文字进入编辑');
      await dispatchKey('Escape', 'Escape', 27);
      await hit('组内形状');
      await expect("session.editor.selection.enteredGroup === ids['测试组'] && session.editor.selection.ids[0] === ids['组内形状']", '旋转组按祖先链只进入一层');
      await hit('组内形状');
      await expect("mount.querySelector('[data-ppt-text-editor]')?.dataset.pptTextEditor === ids['组内形状']", '组内形状进入文字编辑');
      await dispatchKey('Escape', 'Escape', 27); await dispatchKey('Escape', 'Escape', 27);
      await hit('测试图片');
      await expect("mount.querySelector('[data-edit-crop-id]')?.dataset.editCropId === ids['测试图片']", '图片进入裁剪');
      await dispatchKey('Escape', 'Escape', 27);
      await doubleClickElement(context, '#native-double-click [data-table-cell="0:1"]');
      await expect("mount.querySelector('[data-ppt-text-editor]')?.dataset.pptTextCell === '0:1'", '命中第二个单元格而非整张表');
      await dispatchKey('Escape', 'Escape', 27);
      await evaluate("globalThis.nativeDoubleClick.view.setMode('view')");
      await hit('普通形状');
      await expect("!mount.querySelector('[data-ppt-text-editor]')", '查看模式不进入编辑');
      await evaluate("globalThis.nativeDoubleClick.view.setMode('edit')");
      await doubleClickAt(context, { x: 610, y: 340 });
      await expect("session.editor.selection.kind === 'none' && !mount.querySelector('[data-ppt-text-editor]')", '空白不回退到旧选区');
      await expect('session.editor.history.undoCount === 0', '双击与语言无关的进入/退出操作不产生历史');
      if (!await evaluate('globalThis.nativeDoubleClick.captures >= 4 && globalThis.nativeDoubleClick.doubles >= 4')) {
        throw new Error(`${textMode} 双击测试未经过真实根节点 capture`);
      }
      await evaluate(`(() => {
        const { session, ids } = globalThis.nativeDoubleClick;
        session.editor.exec({ type: 'SetXfrm', id: ids['测试表格'], x: 90, y: 120 });
        session.editor.exec({ type: 'SetElementHidden', id: ids['测试表格'], hidden: true });
      })()`);
      await hit('普通形状');
      await expect("mount.querySelector('[data-ppt-text-editor]')?.dataset.pptTextEditor === ids['普通形状']", '隐藏表格不遮挡下方可见文字');
      await dispatchKey('Escape', 'Escape', 27);
    } catch (error) {
      throw new Error(`${textMode} 原生双击停在 ${stage}：${error.message}`, { cause: error });
    } finally {
      await evaluate('globalThis.nativeDoubleClick.session.dispose(); globalThis.nativeDoubleClick.mount.remove(); delete globalThis.nativeDoubleClick');
    }
  }
}
