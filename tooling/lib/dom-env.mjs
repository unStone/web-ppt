/**
 * 给 Node 装上渲染引擎需要的浏览器 API，使 src/ 的代码能在 Node 里原样运行。
 *
 * 覆盖：DOMParser（命名空间正确的 XML 解析）、Blob / URL.createObjectURL、
 * document（canvas 取不到 2d 上下文时，文本测量会自动退到字符宽度估算，结果仍确定）。
 */
import { JSDOM, VirtualConsole } from 'jsdom';

export function installDomEnv() {
  // jsdom 没装 canvas 包，getContext 会刷屏警告；文本测量本就有退化路径，直接静音
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (err) => {
    if (!/getContext/.test(String(err && err.message))) console.error(err);
  });
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { virtualConsole });
  const { window } = dom;

  const g = globalThis;
  g.window = window;
  g.document = window.document;
  g.DOMParser = window.DOMParser;
  g.Element = window.Element;
  g.Node = window.Node;
  g.Image = window.Image;
  g.HTMLElement = window.HTMLElement;
  g.KeyboardEvent = window.KeyboardEvent;
  g.MouseEvent = window.MouseEvent;
  if (!g.Blob) g.Blob = window.Blob;

  // jsdom 没有 createObjectURL；用可回查的假 URL 顶替，
  // 测试里据此判断「产生了几张图」而不必真的解码。
  const blobs = new Map();
  let seq = 0;
  g.URL = window.URL;
  g.URL.createObjectURL = (blob) => {
    const url = `blob:node/${++seq}`;
    blobs.set(url, blob);
    return url;
  };
  g.URL.revokeObjectURL = (url) => blobs.delete(url);

  return { window, dom, blobs };
}

/** 解析一段 SVG/XML，返回 { doc, error }；error 非空表示结构不合法 */
export function parseXml(text) {
  const doc = new globalThis.DOMParser().parseFromString(text, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  return { doc, error: err ? (err.textContent || 'parse error').slice(0, 200) : null };
}
