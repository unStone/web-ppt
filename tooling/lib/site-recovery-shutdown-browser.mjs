import { openEditor } from '@web-ppt/editor';
import * as adjustments from '@web-ppt/editor/adjustments';
import { createEditorApplication } from '../../packages/site/src/editor-application';
import { languageReady } from '../../packages/site/src/i18n/runtime';

const require = (condition, message) => { if (!condition) throw new Error(message); };
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

// 通过应用/会话公开入口重开验证；只延迟存储适配器的追加，底层仍是原生 IndexedDB。
export async function runRecoveryShutdownContract(sourceUrl) {
  await languageReady;
  const bytes = await fetch(sourceUrl).then(response => response.arrayBuffer());
  const preference = 'web-ppt:site:recovery-enabled';
  const savedPreference = localStorage.getItem(preference);
  const host = { canvas: document.querySelector('#canvas'), objects: document.querySelector('#objects'),
    textTools: [], onChange() {} };
  const signal = new AbortController().signal;
  const toggle = document.querySelector('#recoveryToggle');
  const errors = [];
  const notice = (message, kind) => { if (kind === 'error') errors.push(message); };
  try {
    for (const action of ['replace', 'dispose']) {
      localStorage.setItem(preference, 'true');
      const app = await createEditorApplication(host, notice);
      const release = deferred(), entered = deferred();
      let closing, restoredApp;
      try {
        const options = app.recovery.openOptions(signal).recovery;
        const session = await openEditor(bytes, { recovery: { ...options, decide: () => 'discard',
          store: { ...options.store, async append(request) {
            entered.resolve(); await release.promise;
            return options.store.append(request);
          } },
        } });
        await app.replace(session, {}, { adjustments }, signal);
        app.recovery.sync(session);
        const id = Object.values(session.editor.doc.elements).find(record => record.meta.editable === 'full')?.id;
        require(id, '固件必须有可编辑元素');
        const expectedX = session.editor.effectiveElement(id).x + 31;
        session.editor.exec({ type: 'SetXfrm', id, x: expectedX });
        await entered.promise;
        require(session.recovery.pending > 0, '退出前必须确实存在未落盘恢复帧');
        toggle.click();
        require(!app.recovery.openOptions(signal).recovery, '关闭偏好对下次打开生效');
        let replacement;
        if (action === 'replace') replacement = await openEditor(bytes);
        closing = replacement ? app.replace(replacement, {}, { adjustments }, signal) : app.dispose();
        if (!replacement) require(app.dispose() === closing, '重复退出等待同一清理过程');
        const completedEarly = await Promise.race([
          closing.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 50)),
        ]);
        release.resolve();
        await closing;
        require(!completedEarly, `${action} 不能越过当前会话的待写恢复帧`);
        require(session.disposed && session.recovery.pending === 0 && !session.recovery.error,
          `${action} 必须释放旧会话并完成写入`);
        await app.dispose();

        // 新应用创建新的存储连接，读回编辑结果；不窥探 IndexedDB 的内部对象仓库。
        localStorage.setItem(preference, 'true');
        restoredApp = await createEditorApplication(host, notice);
        const reopenOptions = restoredApp.recovery.openOptions(signal).recovery;
        let offered = 0;
        const restored = await openEditor(bytes, { recovery: { ...reopenOptions,
          decide(candidate) {
            offered++;
            const choice = reopenOptions.decide(candidate);
            document.querySelector('#restoreRecovery').click();
            return choice;
          },
        } });
        await restoredApp.replace(restored, {}, { adjustments }, signal);
        require(offered === 1 && restored.editor.effectiveElement(id).x === expectedX,
          `${action} 后关闭并重开存储仍可恢复最后一次编辑`);
        await reopenOptions.store.remove(restored.recovery.source);
      } finally {
        release.resolve();
        await closing;
        await app.dispose();
        await restoredApp?.dispose();
      }
    }
    require(errors.length === 0, `恢复流程没有存储错误：${JSON.stringify(errors)}`);
    return { pendingWritesPersisted: true, actions: ['replace', 'dispose'] };
  } finally {
    if (savedPreference === null) localStorage.removeItem(preference);
    else localStorage.setItem(preference, savedPreference);
  }
}
