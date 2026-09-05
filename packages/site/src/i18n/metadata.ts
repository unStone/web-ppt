import { languageUrl, type SiteLanguage } from './locale';

export function updateSiteMetadata(document: Document, language: SiteLanguage, lookup: (source: string) => string): void {
  document.documentElement.lang = language;
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')!;
  const url = languageUrl(new URL(canonical.href), language);
  url.search = ''; url.hash = '';
  canonical.href = url.href;
  const meta = (attribute: 'name' | 'property', key: string, value: string): void => {
    let element = document.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
    if (!element) { element = document.createElement('meta'); element.setAttribute(attribute, key); document.head.append(element); }
    element.content = value;
  };
  for (const locale of ['zh-CN', 'en', 'x-default'] as const) {
    let link = document.querySelector<HTMLLinkElement>(`link[hreflang="${locale}"]`);
    if (!link) { link = document.createElement('link'); link.rel = 'alternate'; link.hreflang = locale; document.head.append(link); }
    link.href = languageUrl(url, locale === 'zh-CN' ? 'zh-CN' : 'en').href;
  }
  const description = document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? '';
  meta('property', 'og:url', url.href);
  meta('property', 'og:locale', language === 'en' ? 'en_US' : 'zh_CN');
  meta('property', 'og:title', document.title);
  meta('property', 'og:description', description);
  meta('name', 'twitter:title', document.title);
  meta('name', 'twitter:description', description);
  let schema = document.querySelector<HTMLScriptElement>('script[type="application/ld+json"]');
  if (!schema) {
    schema = document.createElement('script'); schema.type = 'application/ld+json';
    schema.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage' });
    document.head.append(schema);
  }
  const source = schema.getAttribute('data-site-json') ?? schema.textContent!;
  schema.setAttribute('data-site-json', source);
  const data = JSON.parse(source);
  const pages = data['@graph'] ?? [data];
  for (const page of pages) {
    page.inLanguage = language; page.url = url.href;
    if (page.description) page.description = lookup(page.description);
    if (page['@type'] === 'WebPage') { page.name = document.title; page.description = description; }
  }
  schema.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
}
