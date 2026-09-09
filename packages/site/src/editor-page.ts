import type { EditorApplication } from './editor-application';
import { editorButtons as buttons, editorElements } from './editor-elements';
import { languageReady, setMessage, setText } from './i18n/runtime';
import { message } from './i18n/message';

const { app, fileInput, canvasState, statusText, documentKind } = editorElements;
const bootstrap = new AbortController();
let loading: Promise<EditorApplication> | undefined;
let languageInitialized = false;

function getApplication(): Promise<EditorApplication> {
  return loading ??= import('./editor-application').then(async ({ createSiteEditorApplication }) => {
    const application = await createSiteEditorApplication();
    bootstrap.abort();
    return application;
  }).catch(error => { loading = undefined; throw error; });
}

function startupFailure(error: unknown): void {
  const failure = message('打开失败：{detail}', { detail: error instanceof Error ? error.message : String(error) });
  canvasState.hidden = false;
  canvasState.querySelector('.spinner')?.setAttribute('hidden', '');
  setText(canvasState.querySelector('strong')!, '演示文稿打开失败');
  setMessage(canvasState.querySelector('small')!, failure);
  setMessage(statusText, failure); statusText.dataset.tone = 'error';
  setText(documentKind, '未打开文稿'); delete app.dataset.loading;
  buttons.newFile.disabled = fileInput.disabled = !languageInitialized;
}

// Cordis 尚未就绪时只保留重试入口，成功接管后不再留下页面级业务监听。
buttons.newFile.disabled = fileInput.disabled = true;
buttons.newFile.addEventListener('click', event => {
  event.stopImmediatePropagation();
  void getApplication().then(application => application.opening?.create()).catch(startupFailure);
}, { signal: bootstrap.signal });
fileInput.addEventListener('change', event => {
  event.stopImmediatePropagation();
  const file = fileInput.files?.[0]; fileInput.value = '';
  if (file) void getApplication().then(application => application.opening?.open(file, file.name)).catch(startupFailure);
}, { signal: bootstrap.signal });
void languageReady.then(async () => {
  languageInitialized = true;
  const application = await getApplication();
  return application.opening?.loadExample(new URL('./demo/showcase.pptx', document.baseURI), 'showcase.pptx');
}).catch(startupFailure);
