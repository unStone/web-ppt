/**
 * 探测当前引擎是否会给 <foreignObject> 里的 HTML 应用外层 SVG 的缩放。
 *
 * WebKit 从 2008 年起就不应用（bug 23113），直到新的 LBSE 引擎才修好。
 * 本引擎的幻灯片是 `viewBox` + `width:100%`，也就是永远处在被缩放的状态，
 * 所以在受影响的 Safari / iOS 上，foreignObject 里的文本会按 1× 排版并错位。
 *
 * Marp 的 marpit-svg-polyfill 用 getScreenCTM() 反算缩放再补回去，但那套做法
 * 要求 foreignObject 就位于幻灯片原点；本引擎的 foreignObject 嵌在每个形状各自的
 * translate/rotate 里，补偿量没法用一个标量表达。既然渲染层本来就有一条原生
 * <text> 路径，受影响时直接切过去更稳——代价只是这些浏览器上文本不可选中。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

let cached: boolean | null = null;

/** 仅供测试：清掉探测缓存 */
export function resetForeignObjectProbe(): void {
  cached = null;
}

/**
 * `doc` 只在首次探测时用到——结论按引擎缓存，同一个页面里不会出现两种 SVG 实现，
 * 没必要为每个 iframe / 游离文档各测一遍。
 */
export function foreignObjectScalesCorrectly(doc: Document): boolean {
  if (cached !== null) return cached;
  const host = doc.body ?? doc.documentElement;
  if (!host) return true;

  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('width', '200');
  svg.setAttribute('height', '200');
  svg.setAttribute('style', 'position:absolute;left:-9999px;top:-9999px;pointer-events:none');

  const fo = doc.createElementNS(SVG_NS, 'foreignObject');
  fo.setAttribute('width', '100');
  fo.setAttribute('height', '100');
  const div = doc.createElementNS(XHTML_NS, 'div');
  div.setAttribute('style', 'width:100px;height:100px');
  fo.appendChild(div);
  svg.appendChild(fo);
  host.appendChild(svg);

  // viewBox 宽 100 渲染到 200px，即缩放 2×；正确实现下这个 div 的屏幕宽度应是 200
  const w = div.getBoundingClientRect().width;
  svg.remove();

  // 量不到尺寸（headless、display:none、jsdom）时不做降级——宁可保留更好的那条路径
  cached = w === 0 || w > 150;
  return cached;
}
