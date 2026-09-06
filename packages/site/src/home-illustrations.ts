import { parse, renderSlideToSvg } from '@web-ppt/core';
import { message, type SiteMessage } from './i18n/message';
import { setText, setMessage, setAttributeText } from './i18n/runtime';

export function drawArch(): void {
  const labels: SiteMessage[] = [];
  const label = (value: SiteMessage): string => `<tspan data-arch-label="${labels.push(value) - 1}"></tspan>`;
  const box = (x: number, y: number, w: number, h: number, title: string, sub: string, accent = false): string => `
    <g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8"
        fill="${accent ? 'var(--accent-soft)' : 'var(--bg)'}"
        stroke="${accent ? 'var(--accent)' : 'var(--line)'}" stroke-width="1.2"/>
      <text x="${x + w / 2}" y="${y + (sub ? 25 : h / 2 + 4)}" text-anchor="middle"
        fill="${accent ? 'var(--accent)' : 'var(--fg)'}" font-size="13" font-weight="600">${title}</text>
      ${sub ? `<text x="${x + w / 2}" y="${y + 43}" text-anchor="middle"
        fill="var(--fg-faint)" font-size="10.5" font-family="var(--mono)">${sub}</text>` : ''}
    </g>`;

  const arrow = (x1: number, y1: number, x2: number, y2: number, label = ''): string => `
    <g>
      <path d="M${x1} ${y1} L${x2 - 7} ${y2}" stroke="var(--fg-faint)" stroke-width="1.2" fill="none"/>
      <path d="M${x2 - 7} ${y2 - 3.5} L${x2} ${y2} L${x2 - 7} ${y2 + 3.5}Z" fill="var(--fg-faint)"/>
      ${label ? `<text x="${(x1 + x2) / 2}" y="${y1 - 7}" text-anchor="middle"
        fill="var(--fg-faint)" font-size="10" font-family="var(--mono)">${label}</text>` : ''}
    </g>`;

  const host = document.querySelector('#archDiagram')!;
  host.innerHTML = `
<svg viewBox="0 0 900 260" xmlns="http://www.w3.org/2000/svg" role="img">
  <text x="92" y="18" text-anchor="middle" fill="var(--fg-faint)" font-size="10.5" letter-spacing=".08em">${label(message('输入'))}</text>
  ${box(20, 28, 145, 56, '.pptx', 'Zip + OOXML')}
  ${box(20, 100, 145, 56, '.ppt', 'CFB + OfficeArt')}
  ${box(20, 172, 145, 56, 'EMF / WMF / PICT', 'GDI / QuickDraw')}

  ${arrow(165, 56, 285, 90, 'fflate')}
  ${arrow(165, 128, 285, 118, 'Escher')}
  ${arrow(165, 200, 285, 146, 'GDI')}

  <text x="368" y="18" text-anchor="middle" fill="var(--fg-faint)" font-size="10.5" letter-spacing=".08em">${label(message('中间表示'))}</text>
  ${box(285, 72, 166, 92, label(message('统一 Schema')), 'types.ts', true)}
  <text x="368" y="180" text-anchor="middle" fill="var(--fg-faint)" font-size="10">${label(message('与文件格式无关'))}</text>

  ${arrow(451, 100, 570, 62)}
  ${arrow(451, 136, 570, 174)}

  <text x="647" y="18" text-anchor="middle" fill="var(--fg-faint)" font-size="10.5" letter-spacing=".08em">${label(message('渲染'))}</text>
  ${box(570, 34, 154, 56, label(message('HTML 文本')), 'foreignObject')}
  ${box(570, 146, 154, 56, label(message('SVG 文本')), label(message('自实现断行')))}

  ${arrow(724, 62, 790, 62)}
  ${arrow(724, 174, 790, 174)}
  ${box(790, 34, 92, 56, label(message('预览')), label(message('可选中')))}
  ${box(790, 146, 92, 56, label(message('导出')), 'PNG/PDF')}
</svg>`;
  setAttributeText(host.querySelector('svg')!, 'aria-label', 'Web-PPT 架构图');
  labels.forEach((value, index) => setMessage(host.querySelector(`[data-arch-label="${index}"]`)!, value));
}


/* ── 疑难杂症 ─────────────────────────────────── */

/**
 * 卡片骨架（标题 / 说明 / 天真做法）写死在 index.html 里，这里只把引擎渲染
 * 结果填进每张卡的 .good .pane。
 *
 * 这么分工有两个理由：首轮抓取不执行 JS，标题与说明必须在静态 HTML 里才算数；
 * JS 关掉时也还剩「天真做法」一侧可看，不至于是六个空框。
 *
 * 卡片顺序与 tooling/make-hardcases-fixture.mjs 的 CASES 一一对应，改一边要改两边。
 */
async function renderHardCases(): Promise<void> {
  const panes = document.querySelectorAll<HTMLElement>('#hardGrid .good .pane');
  if (!panes.length) return;

  try {
    const res = await fetch('demo/hardcases.pptx');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const pres = await parse(await res.arrayBuffer());
    panes.forEach((host, i) => {
      const slide = pres.slides[i];
      if (slide) host.innerHTML = renderSlideToSvg(pres, slide, { textMode: 'svg' });
    });
  } catch {
    // 案例展示不该拖垮整页：取不到固件就只留天真侧，不弹错
    panes.forEach((p) => setText(p, '样本载入失败'));
  }
}

/**
 * 六张卡在整页最底下，进来的人未必滚得到。固件不大，但解析加渲染六页 SVG 是
 * 实打实的主线程活儿，没人看的时候干这些纯属白烧电。滚到了再说。
 */
export function initializeHardCases(): void {
  const hardGrid = document.querySelector<HTMLElement>('#hardGrid');
  if (hardGrid && 'IntersectionObserver' in window) {
    const hardIo = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          hardIo.disconnect();
          void renderHardCases();
        }
      },
      { rootMargin: '200px' },
    );
    hardIo.observe(hardGrid);
  } else {
    void renderHardCases();
  }
}
