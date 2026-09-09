import { openFixture } from './site-editor-browser-helpers.mjs';
import { saveKey } from './site-local-save-async-contract.mjs';

export async function runLocalSaveLifecycleContract(context) {
  const { evaluate, click, waitFor, request } = context;
  await openFixture(context, '/fixtures/sample.ppt', '<旧保存 & 原文>.ppt');
  const before = await evaluate('globalThis.__pickerCalls.length');
  await saveKey(context);
  if (!await evaluate(`document.querySelector('#saveToFile').disabled && globalThis.__pickerCalls.length === ${before}`)) {
    throw new Error('未确认旧格式转换前不能通过保存快捷键写入文件');
  }
  await click('#editMode');
  await waitFor("document.querySelector('#documentKind').textContent === 'PPT → PPTX · Editable'", '转换后的旧格式允许保存为 PPTX');
  await click('#addShape');
  const count = await evaluate("document.querySelectorAll('[data-pane-element]').length");
  await saveKey(context);
  await waitFor("document.querySelector('#statusText').textContent === 'Saved to local-save.pptx' && !document.querySelector('#saveToFile').disabled", '生成式 PPTX 实际写入文件');
  if (!await evaluate(`globalThis.__pickerCalls.length === ${before + 1}
    && globalThis.__pickerCalls.at(-1).suggestedName === '<旧保存 & 原文>.pptx'`)) throw new Error('旧格式不得继承上一文稿的保存目标或保留 .ppt 扩展名');
  await reopenLocalFile(context, count);
  await click('#newFile');
  await waitFor("document.querySelector('#templateDialog')?.open", '新建空白文稿');
  await click('[data-template-id="blank"]');
  await waitFor("document.querySelector('#fileName').textContent === 'Untitled presentation.pptx' && !document.querySelector('#editorApp').dataset.loading", '空白文稿就绪');
  if (!await evaluate("document.querySelector('#saveAsFile').hidden && document.querySelector('#saveToFile').title === 'Save destination: Choose a destination'")) {
    throw new Error('新建文稿继承了旧文件目标');
  }
  await click('#addShape');
  await request('Emulation.setDeviceMetricsOverride', { width: 320, height: 844, deviceScaleFactor: 1, mobile: true });
  await request('Emulation.setTouchEmulationEnabled', { enabled: true });
  try {
    await evaluate(`(() => {
      globalThis.__saveTouchTrace=[];
      const events=['touchstart','touchend','pointerdown','pointerup','click'];
      const record=event=>globalThis.__saveTouchTrace.push({type:event.type,target:event.target.id,
        x:event.clientX,y:event.clientY,trusted:event.isTrusted,prevented:event.defaultPrevented});
      for(const name of events)document.addEventListener(name,record,true);
      globalThis.__stopSaveTouchTrace=()=>events.forEach(name=>document.removeEventListener(name,record,true));
    })()`);
    const point = await evaluate(`(async () => {
      const button = document.querySelector('#saveToFile'); button.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      globalThis.__saveTouchTrace.push({phase:'before-frame',rect:button.getBoundingClientRect().toJSON()});
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const rect = button.getBoundingClientRect();
      globalThis.__saveTouchTrace.push({phase:'after-frame',rect:rect.toJSON()});
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      if (rect.left < 0 || rect.right > 321 || y < 0 || y > 844 || !button.contains(document.elementFromPoint(x, y))) {
        throw new Error('320px 保存按钮不可见或被遮挡');
      }
      // CDP 触点相对可视视口；DOM client 坐标相对布局视口，移动端滚动后两者原点不同。
      globalThis.__saveTouchTrace.push({phase:'viewport',offsetLeft:visualViewport.offsetLeft,offsetTop:visualViewport.offsetTop});
      return { x:x-visualViewport.offsetLeft, y:y-visualViewport.offsetTop };
    })()`,true);
    await request('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await request('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await waitFor(`globalThis.__pickerCalls.length === ${before + 2}
      && document.querySelector('#statusText').textContent === 'Saved to local-save.pptx'
      && !document.querySelector('#fileName').textContent.startsWith('● ')`, '窄屏真实触点保存新建文稿');
    console.log('  窄屏触点验收：',JSON.stringify(await evaluate('globalThis.__saveTouchTrace')));
  } catch(error) {
    throw new Error(`${error.message}；触点记录：${JSON.stringify(await evaluate(`({events:globalThis.__saveTouchTrace,
      width:innerWidth,height:innerHeight,viewport:{width:visualViewport.width,height:visualViewport.height,scale:visualViewport.scale},
      button:document.querySelector('#saveToFile').getBoundingClientRect().toJSON()})`))}`,{cause:error});
  } finally {
    await evaluate('globalThis.__stopSaveTouchTrace?.(); delete globalThis.__stopSaveTouchTrace; delete globalThis.__saveTouchTrace');
    await request('Emulation.setTouchEmulationEnabled', { enabled: false });
    await request('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  }
  await reopenLocalFile(context, 1);
}

export async function reopenLocalFile({ evaluate, waitFor }, count) {
  await evaluate(`(async () => {
    const transfer = new DataTransfer(); transfer.items.add(await globalThis.__savedHandle.getFile());
    const input = document.querySelector('#fileInput'); input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  await waitFor(`document.querySelector('#fileName').textContent === 'local-save.pptx'
    && !document.querySelector('#editorApp').dataset.loading
    && document.querySelectorAll('[data-pane-element]').length === ${count}`, '真实保存文件重开保持对象数量');
}
