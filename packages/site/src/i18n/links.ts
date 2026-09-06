import { languageUrl, normalizeLanguage, type SiteLanguage } from './locale';

/** 只认领页面骨架的站内导航；样本出处和文稿内链接不属于站点。 */
export function bindSiteLinks(document: Document): {
  apply: (language: SiteLanguage, page: URL) => void;
  add: (anchor: HTMLAnchorElement, href: string) => void;
} {
  const navigation = new Map([...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
    .filter((anchor) => !anchor.closest('[data-site-language],[data-site-user-content],svg')
      && (!anchor.closest('.sample-card') || anchor.hasAttribute('data-site-message')))
    .map((anchor) => [anchor, anchor.getAttribute('href')!]));
  const controls = [...document.querySelectorAll<HTMLAnchorElement>('[data-site-locale]')];
  const apply = (language: SiteLanguage, page: URL): void => {
    const directory = page.pathname.slice(0, page.pathname.lastIndexOf('/') + 1);
    const relative = (url: URL): string => `${url.pathname.slice(directory.length) || './'}${url.search}${url.hash}`;
    for (const [anchor, href] of navigation) {
      if (href.startsWith('#')) continue;
      const url = new URL(href, page);
      if (url.origin !== page.origin || !url.pathname.startsWith(directory)) continue;
      if (!/^(?:(?:index|samples|editor)(?:\.en)?\.html)?$/.test(url.pathname.slice(directory.length))) continue;
      const target = languageUrl(url, language);
      if (language === 'zh-CN') target.searchParams.set('lang', language);
      anchor.href = relative(target);
    }
    for (const anchor of controls) {
      const locale = normalizeLanguage(anchor.dataset.siteLocale!);
      const target = languageUrl(page, locale);
      if (locale === 'zh-CN') target.searchParams.set('lang', locale);
      anchor.href = relative(target);
      anchor.setAttribute('aria-current', String(locale === language));
    }
  };
  return { apply, add: (anchor, href) => { navigation.set(anchor, href); } };
}
