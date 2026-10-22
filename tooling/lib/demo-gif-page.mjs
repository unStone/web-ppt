/**
 * 录制页的入口，由 make-demo-gif.mjs 用 esbuild 从源码打包。
 *
 * 渲染链路照搬官网样本页（samples.ts）：嵌入字体解码、现代图表、高级渲染、
 * 字体替换一样不少——README 里放的画面必须就是访客在样本页看到的画面，
 * 少接一个 hook，录出来的就是一份官网上并不存在的「效果图」。
 */
import { prepareAdvancedRendering } from '@web-ppt/core/advanced-rendering';
import { prepareModernCharts } from '@web-ppt/core/modern-charts';
import { collectFonts, parse, setFontDecoder } from '@web-ppt/core';
import { loadFontsFor } from '@web-ppt/fonts';
import { Viewer } from '@web-ppt/viewer-core';
import { eotToTtf } from 'mtx-decompressor';

setFontDecoder(eotToTtf);

const file = new URLSearchParams(location.search).get('file');
if (!file) throw new Error('录制页缺少 ?file= 参数');
const response = await fetch(file);
if (!response.ok) throw new Error(`样本 ${file} 读取失败：HTTP ${response.status}`);
const bytes = new Uint8Array(await response.arrayBuffer());

await Promise.all([prepareModernCharts(bytes), prepareAdvancedRendering(bytes)]);
const pres = await parse(bytes);

// 样本页按页懒加载替换字体，看到的第一帧可能是回退字体；录制要求每一帧都是终态，
// 所以开录前把全部页面用到的字体一次加载完
const usages = collectFonts(pres.slides);
const fonts = usages.length ? await loadFontsFor(usages) : [];
const failed = fonts.filter((f) => f.status === 'failed');
if (failed.length) throw new Error(`字体加载失败：${failed.map((f) => f.family).join(', ')}`);
await document.fonts.ready;

const stage = document.getElementById('stage');
const viewer = new Viewer(stage, pres, { skipHidden: true });
viewer.setAnimate(true);

const ring = document.getElementById('ring');

window.__demo = {
  viewer,
  width: pres.width,
  height: pres.height,
  /** 跳页按钮在当前页的位置，供挑分镜与点击定位；坐标是视口像素 */
  links() {
    return [...stage.querySelectorAll('[data-slide]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { slide: el.getAttribute('data-slide'), x: r.x, y: r.y, w: r.width, h: r.height };
    }).filter((l) => l.w > 0 && l.h > 0);
  },
  /** 屏幕录制里没有鼠标指针，点击位置靠这圈涟漪交代给观众 */
  pulse(x, y) {
    ring.style.left = `${x}px`;
    ring.style.top = `${y}px`;
    ring.classList.remove('on');
    void ring.offsetWidth;
    ring.classList.add('on');
  },
};
window.__ready = true;
