export type SiteLanguage = 'zh-CN' | 'en';

export function normalizeLanguage(value: string): SiteLanguage {
  return /^zh(?:-|_|$)/i.test(value) ? 'zh-CN' : 'en';
}

/** URL 是可分享的明确选择，存储偏好和浏览器语言都不能覆盖它。 */
export function resolveLanguage(url: URL, preference: string | null, browserLanguage: string): SiteLanguage {
  const explicit = url.searchParams.get('lang');
  if (explicit !== null) return normalizeLanguage(explicit);
  if (/\.en\.html$/.test(url.pathname)) return 'en';
  return normalizeLanguage(preference ?? browserLanguage);
}

/** 英文镜像与原页面同级，静态部署子路径下不需要重写相对资源地址。 */
export function languageUrl(input: URL, language: SiteLanguage): URL {
  const url = new URL(input);
  const match = /(?:^|\/)(index|samples|editor)(?:\.en)?\.html$/.exec(url.pathname);
  const page = match?.[1] ?? (url.pathname.endsWith('/') ? 'index' : null);
  if (!page) return url;
  const directory = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
  url.pathname = directory + (language === 'en' ? `${page}.en.html` : page === 'index' ? '' : `${page}.html`);
  url.searchParams.delete('lang');
  return url;
}
