import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import type { Plugin } from 'vite';
import { messages } from './src/i18n/messages';
import { homeMessages } from './src/i18n/en-home';
import { editorMessages } from './src/i18n/en-editor';
import { sampleMessages } from './src/i18n/en-samples';
import { bindStaticText } from './src/i18n/static-text';
import { updateSiteMetadata } from './src/i18n/metadata';
import type { SiteLanguage } from './src/i18n/locale';
import { bindSiteLinks } from './src/i18n/links';

function localizedHtml(html: string, language: SiteLanguage): string {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const translate = (source: string): string => {
    if (!Object.hasOwn(messages, source)) throw new Error(`官网缺少英文词条：${source}`);
    return language === 'zh-CN' ? source : messages[source as keyof typeof messages];
  };
  bindStaticText(document)(translate);
  updateSiteMetadata(document, language, translate);
  bindSiteLinks(document).apply(language, new URL(document.querySelector<HTMLLinkElement>('link[rel="canonical"]')!.href));
  const output = dom.serialize();
  dom.window.close();
  return output;
}

/** 两种语言使用同一份结构和产物资源，不维护会漂移的第二套 HTML。 */
export function siteI18n(): Plugin {
  const seen = new Map<string, string>();
  const parameters = (value: string): string => [...new Set([...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort().join(',');
  for (const catalog of [homeMessages, editorMessages, sampleMessages]) for (const [source, target] of Object.entries(catalog)) {
    if (seen.has(source) && seen.get(source) !== target) throw new Error(`官网词条翻译冲突：${source}`);
    if (parameters(source) !== parameters(target)) throw new Error(`官网词条参数不一致：${source}`);
    seen.set(source, target);
  }
  return {
    name: 'site-i18n', enforce: 'post',
    transformIndexHtml: { order: 'post', handler: (html, context) =>
      localizedHtml(html, context.path.endsWith('.en.html') ? 'en' : 'zh-CN') },
    generateBundle(_options, bundle) {
      for (const [name, artifact] of Object.entries(bundle)) {
        if (artifact.type !== 'asset' || !/^(index|samples|editor)\.html$/.test(name)) continue;
        this.emitFile({ type: 'asset', fileName: name.replace('.html', '.en.html'),
          source: localizedHtml(String(artifact.source), 'en') });
      }
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        const page = /\/(index|samples|editor)\.en\.html$/.exec(url.pathname)?.[1];
        if (!page) return next();
        try {
          const html = readFileSync(resolve(server.config.root, `${page}.html`), 'utf8');
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.end(await server.transformIndexHtml(url.pathname, html));
        } catch (error) { next(error); }
      });
    },
  };
}
