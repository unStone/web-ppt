import { bindStaticText } from './static-text';
import { updateSiteMetadata } from './metadata';
import { bindSiteLinks } from './links';
import { languageUrl, normalizeLanguage, resolveLanguage, type SiteLanguage } from './locale';
import type { Message } from './messages';

const preferenceKey = 'web-ppt:site:language';
const applyStatic = bindStaticText(document);
const applyLinks = bindSiteLinks(document);
let language = normalizeLanguage(document.documentElement.lang);
let dictionary: Readonly<Record<string, string>> | undefined;
let loading: Promise<void> | undefined;
let generation = 0;

type ParametersIn<S extends string> = S extends `${string}{${infer P}}${infer Rest}` ? P | ParametersIn<Rest> : never;
type Arguments<S extends string> = [ParametersIn<S>] extends [never] ? [] : [Record<ParametersIn<S>, string | number>];
interface BoundMessage { source: Message; parameters: Record<string, string | number> }
const dynamic = new WeakMap<Element, BoundMessage>();

function format(source: string, parameters: Record<string, string | number> = {}): string {
  const template = language === 'en' ? dictionary?.[source] : source;
  if (template === undefined) throw new Error(`Missing site message: ${source}`);
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(parameters, key)) throw new Error(`Missing message argument: ${key}`);
    return String(parameters[key]);
  });
}

export function t<S extends Message>(source: S, ...args: Arguments<S>): string {
  return format(source, args[0]);
}

/** 保存消息身份和参数，不反向匹配已渲染文本，因此文件名和用户内容永远不是词条。 */
export function setText<S extends Message>(target: Element, source: S, ...args: Arguments<S>): void {
  const parameters = args[0] ?? {};
  dynamic.set(target, { source, parameters });
  target.setAttribute('data-site-dynamic', '');
  // 英文静态页的模块初始化早于按需词库；先登记，词库就绪后统一兑现。
  if (language === 'en' && !dictionary) return;
  target.textContent = format(source, parameters);
}

function savedLanguage(): string | null {
  try { return localStorage.getItem(preferenceKey); } catch { return null; }
}

async function changeLanguage(next: SiteLanguage, explicit: boolean): Promise<void> {
  const current = ++generation;
  if (next === 'en' && !dictionary) {
    loading ??= import('./messages').then((module) => { dictionary = module.messages; })
      .catch((error) => { loading = undefined; throw error; });
    await loading;
  }
  if (current !== generation) return;
  language = next;
  if (explicit) {
    try { localStorage.setItem(preferenceKey, language); } catch { /* URL 在存储被禁用时仍可保留明确选择。 */ }
    const url = languageUrl(new URL(location.href), language);
    if (language === 'zh-CN') url.searchParams.set('lang', language);
    history.replaceState(history.state, '', url);
  }
  applyStatic((source) => format(source));
  applyLinks(language, new URL(location.href));
  for (const element of document.querySelectorAll('[data-site-dynamic]')) {
    const message = dynamic.get(element);
    if (message) element.textContent = format(message.source, message.parameters);
  }
  updateSiteMetadata(document, language, (source) => format(source));
  document.querySelector('#siteLanguage [role="alert"]')?.remove();
}

function reportFailure(error: unknown): void {
  console.error(error);
  const control = document.querySelector('#siteLanguage');
  if (!control) return;
  let status = control.querySelector('[role="alert"]');
  if (!status) { status = document.createElement('span'); status.setAttribute('role', 'alert'); control.append(status); }
  status.textContent = 'Language unavailable / 语言暂不可用';
}

document.querySelector('#siteLanguage')?.addEventListener('click', (event) => {
  const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('[data-site-locale]') : null;
  if (!anchor || event instanceof MouseEvent && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0)) return;
  event.preventDefault();
  void changeLanguage(normalizeLanguage(anchor.dataset.siteLocale!), true).catch(reportFailure);
});

export const languageReady = changeLanguage(resolveLanguage(new URL(location.href), savedLanguage(), navigator.language), false)
  .catch(reportFailure);
