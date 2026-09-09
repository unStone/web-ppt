import type {EditorSession} from '@web-ppt/editor';
import type {DocumentFontService,EmbeddedFontStatus} from './editor-document-fonts';
import {inspectDocumentFonts} from './editor-font-diagnostics';
import {fontProblemMessage} from './editor-font-labels';
import {setText,setMessage} from './i18n/runtime';
import {moveLanguageControl} from './i18n/controls';
import {message,type SiteMessage} from './i18n/message';

interface FontToolsContext {session: EditorSession | null; fonts?: DocumentFontService; showSlide(id: string): void}

/** 弹窗只持有一次检查的取消权，字体资源始终归 Cordis 文稿服务所有。 */
export function showFontTools(context: () => FontToolsContext, onClose: () => void): (() => void) | undefined {
  const {session,fonts} = context();
  if (!session || !fonts || document.querySelector('#fontDialog')) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'fontDialog'; dialog.setAttribute('aria-labelledby','fontDialogTitle');
  dialog.innerHTML = `<style>
#fontDialog{box-sizing:border-box;width:min(720px,calc(100vw - 32px));max-height:calc(100vh - 32px);padding:24px;border:1px solid var(--line);border-radius:14px;color:var(--ink);background:#fff}
#fontDialog::backdrop{background:#11182770}#fontDialog h2{margin:0;font-size:20px}#fontDialog h3{font-size:16px;margin:20px 0 8px}
#fontDialog p,#fontDialog li{line-height:1.5}#fontDialog .font-head,#fontDialog .font-actions{display:flex;gap:12px;align-items:center;justify-content:space-between}
#fontDialog .font-hint{font-size:13px;color:var(--muted)}#fontDialog ul{padding-left:20px}#fontDialog li{margin:6px 0;overflow-wrap:anywhere}
#fontDialog label{display:grid;gap:6px;margin:12px 0}#fontDialog input{box-sizing:border-box;width:100%;padding:8px;border:1px solid var(--line);border-radius:6px}
#fontDialog [role=alert]{color:#a82917}#fontDialog .font-location{border:0;background:none;color:#245acb;text-align:left;padding:0;cursor:pointer;font:inherit}
</style><div class="font-head"><h2 id="fontDialogTitle"></h2></div>
<p id="fontScopeHint" class="font-hint"></p><p id="fontFallbackHint" class="font-hint"></p>
<div class="font-actions"><button id="checkFonts" class="button" type="button"></button><button id="closeFontDialog" class="button" type="button"></button></div>
<p id="fontStatus" role="status" aria-live="polite"></p><p id="fontError" role="alert"></p>
<h3 id="embeddedFontTitle"></h3><ul id="embeddedFontStatus"></ul>
<h3 id="activeFontTitle"></h3><ul id="activeFontStatus"></ul>
<h3 id="fontIssuesTitle"></h3><ul id="fontIssues"></ul>
<form id="fontFileForm"><label><span id="fontFileLabel"></span><input id="fontFile" type="file" accept=".ttf,.otf,.ttc,.woff,.woff2,.eot,.fntdata" required></label>
<label><span id="fontFamilyLabel"></span><input id="fontFamily" type="text" maxlength="256" list="fontFamilies"></label><datalist id="fontFamilies"></datalist>
<button id="applyFontFile" class="button primary" type="submit"></button></form>`;
  const get = <T extends HTMLElement>(id: string) => dialog.querySelector<T>(`#${id}`)!;
  for (const [id,label] of [
    ['fontDialogTitle','字体与缺字'],['checkFonts','重新检查字体'],['closeFontDialog','关闭'],
    ['embeddedFontTitle','嵌入字体检查'],['activeFontTitle','已应用字体'],['fontIssuesTitle','需要处理的文字'],
    ['fontFileLabel','字体文件（最大 32 MiB）'],['fontFamilyLabel','替换的字体名称（留空使用文件中的名称）'],
    ['applyFontFile','加载并应用字体'],
    ['fontScopeHint','检查文稿字体并加载本机字体文件。字体用于本次预览和图片、SVG、PDF 导出，关闭文稿后释放；新增字体不会写入 PPTX。'],
    ['fontFallbackHint','按编辑许可检查字体；未取得字节或缺字的内容仍可能使用系统回退字体，不能保证跨设备一致。'],
  ] as const) setText(get(id),label);
  const lifetime = new AbortController(), signal = lifetime.signal;
  let revision = 0, busy = false, statuses: EmbeddedFontStatus[] = [];
  const live = () => !signal.aborted && context().session === session && !session.disposed;
  const unsubscribe = session.editor.subscribe(() => {
    revision++;
    if (live()) setText(get('fontStatus'),'文稿已变化，请重新检查字体');
  });
  const row = (list: HTMLElement, value: SiteMessage) => {
    const item = document.createElement('li'); setMessage(item,value); list.append(item); return item;
  };
  const activeStatus = () => {
    const list = get('activeFontStatus'), faces = fonts.activeFaces(); list.replaceChildren();
    if (!faces.length) row(list,message('未加载可编辑字体'));
    for (const face of faces) row(list,message('{family} · 字重 {weight}{italic} · 来源：{source}',{
      family:face.family,weight:face.weight,italic:face.italic ? message(' · 斜体') : '',source:face.sourceLabel || face.sourceFamily,
    }));
  };
  const check = async () => {
    const version = revision;
    statuses = await fonts.activate({signal});
    if (!live()) return;
    const list = get('embeddedFontStatus'); list.replaceChildren();
    if (!statuses.length) row(list,message('文稿没有嵌入字体'));
    for (const item of statuses) row(list,message('{family}：{reason}',{family:item.source.family,
      reason:item.result.ok ? message('已通过编辑许可检查') : fontProblemMessage(item.result.reason)}));
    activeStatus();
    const provider = await fonts.provider(signal), result = await inspectDocumentFonts(session,provider,fonts.activeFaces(),signal);
    if (!live()) return;
    if (version !== revision) { setText(get('fontStatus'),'文稿已变化，请重新检查字体'); return; }
    get('fontIssues').replaceChildren();
    if (!result.issues.length) row(get('fontIssues'),message('没有发现缺字或字体来源问题'));
    const families = new Set([...fonts.activeFaces().map(face => face.family),...statuses.map(item => item.source.family)]);
    for (const issue of result.issues) {
      if (issue.family) families.add(issue.family);
      const item = document.createElement('li'), button = document.createElement('button'); button.type = 'button';
      button.className = 'font-location';
      setMessage(button,message('第 {page} 页 · {object} · {family}：{reason}',{page:issue.page,object:issue.object,
        family:issue.family,reason:fontProblemMessage(issue.failure.reason)}));
      button.addEventListener('click',() => { if (live()) context().showSlide(issue.slideId); close(); },{signal});
      item.append(button);
      for (const missing of issue.failure.missing ?? []) {
        const detail = document.createElement('div');
        setText(detail,'缺字：{text}（字符区间 {start}–{end}）',{text:missing.text,start:missing.start + 1,end:missing.end}); item.append(detail);
      }
      get('fontIssues').append(item);
    }
    get('fontFamilies').replaceChildren(...[...families].sort().map(family => {
      const option = document.createElement('option'); option.value = family; return option;
    }));
    setText(get('fontStatus'),'已检查 {count} 段文字，发现 {issues} 项问题',{count:result.checkedRuns,issues:result.issues.length});
  };
  const run = async (task: () => Promise<void>) => {
    if (busy || !live()) return;
    busy = true; setMessage(get('fontError'),''); setText(get('fontStatus'),'正在检查字体与缺字…');
    for (const id of ['checkFonts','applyFontFile','fontFile','fontFamily']) get<HTMLInputElement>(id).disabled = true;
    try { await task(); }
    catch (error) { if (live()) setText(get('fontError'),'字体检查失败：{detail}',{detail:error instanceof Error ? error.message : String(error)}); }
    finally {
      busy = false;
      if (live()) { activeStatus(); for (const id of ['checkFonts','applyFontFile','fontFile','fontFamily']) get<HTMLInputElement>(id).disabled = false; }
    }
  };
  const close = () => {
    if (signal.aborted) return;
    lifetime.abort(); unsubscribe(); restoreLanguage(); dialog.close(); dialog.remove(); onClose();
  };
  get('closeFontDialog').addEventListener('click',close,{signal});
  dialog.addEventListener('close',close,{once:true});
  get('checkFonts').addEventListener('click',() => void run(check),{signal});
  get('fontFileForm').addEventListener('submit',event => {
    event.preventDefault();
    const file = get<HTMLInputElement>('fontFile').files?.[0], family = get<HTMLInputElement>('fontFamily').value.trim();
    void run(async () => {
      if (!file?.size || file.size > 32 * 1024 * 1024) {
        setText(get('fontError'),'请选择非空且不超过 32 MiB 的字体文件'); setMessage(get('fontStatus'),''); return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!live()) return;
      const result = await fonts.load({bytes,origin:family ? 'substitute' : 'explicit',family:family || undefined,
        sourceLabel:file.name},{signal});
      if (!live()) return;
      if (!result.ok) { setMessage(get('fontError'),fontProblemMessage(result.reason)); setMessage(get('fontStatus'),''); return; }
      await check();
    });
  },{signal});
  document.body.append(dialog);
  const restoreLanguage = moveLanguageControl(dialog.querySelector('.font-head')!);
  dialog.showModal(); void run(check);
  return close;
}
