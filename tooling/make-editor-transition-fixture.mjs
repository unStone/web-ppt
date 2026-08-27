/** 40 种可播放切换与无切换页，覆盖标准、p14、morph、timing 和无关 MCE。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, label, slideXml, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
const P159 = 'http://schemas.microsoft.com/office/powerpoint/2015/09/main';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

const standard = [
  ['fade', ''], ['cut', ''], ['push', ' dir="l"'], ['pull', ' dir="r"'],
  ['cover', ' dir="u"'], ['wipe', ' dir="d"'], ['split', ' orient="vert" dir="out"'],
  ['zoom', ' dir="in"'], ['dissolve', ''], ['checker', ' dir="horz"'],
  ['blinds', ' dir="vert"'], ['comb', ' dir="horz"'], ['wheel', ''], ['circle', ''],
  ['diamond', ''], ['plus', ''], ['wedge', ''], ['newsflash', ''], ['randomBar', ' dir="vert"'],
  ['strips', ' dir="rd"'],
];
const extended = [
  ['vortex', ''], ['switch', ''], ['flip', ''], ['ripple', ''], ['honeycomb', ''],
  ['glitter', ' dir="l" pattern="hexagon"'], ['warp', ''], ['flythrough', ' dir="in"'], ['flash', ''],
  ['shred', ''], ['reveal', ' dir="r"'], ['wheelReverse', ''], ['ferris', ''],
  ['gallery', ' dir="l"'], ['conveyor', ' dir="r"'], ['pan', ' dir="u"'],
  ['doors', ' dir="vert"'], ['window', ' dir="horz"'], ['prism', ''],
];

const direct = (type, attrs, index) => {
  const untouched = index === 0
    ? ' advClick="0" fixture:transition="keep"' : index === 1 ? ' advClick="0"' : '';
  const sound = index === 0 ? '<p:sndAc><p:endSnd/></p:sndAc>' : '';
  const unknown = index === 0 ? '<fixture:fade fixture:child="keep"/>' : '';
  const duration = index === 0
    ? ` xmlns:x14="${P14}" x14:dur="800" fixture:dur="4999"`
    : ` xmlns:p14="${P14}" p14:dur="${800 + index * 7}"`;
  const sourceType = type === 'fade' ? 'fadeThroughBlack' : type === 'dissolve' ? 'random' : type;
  const aliasAttrs = type === 'dissolve'
    ? ' xmlns:fixture="urn:web-ppt:transition-fixture" fixture:alias="keep"' : '';
  return `<p:transition${duration}` +
    `${index === 1 ? ' advTm="2400"' : ''}${untouched}>` +
    `${unknown}<p:${sourceType}${attrs}${aliasAttrs}${index === 0 ? ' fixture:effect="keep"' : ''}/>${sound}</p:transition>`;
};
const alternate = (type, attrs, index) =>
  `<mc:AlternateContent xmlns:mc="${MC}"` +
  (index === 0 ? ' xmlns:fixture="urn:web-ppt:transition-fixture" mc:Ignorable="fixture" fixture:carrier="keep"' : '') + '>' +
  (index === 0 ? '<mc:Choice xmlns:p200="urn:web-ppt:future" Requires="p200"><p:transition><p200:futureEffect/></p:transition></mc:Choice>' : '') +
  `<mc:Choice xmlns:p14="${P14}" Requires="p14"${index === 0 ? ' fixture:branch="keep"' : ''}>` +
  `<p:transition p14:dur="${1100 + index * 9}"><p14:${type}${attrs}/></p:transition>` +
  (index === 0 ? '<fixture:keep xmlns:fixture="urn:web-ppt:transition-fixture" value="choice"/>' : '') +
  `</mc:Choice><mc:Fallback><p:transition spd="med"><p:fade/></p:transition></mc:Fallback>` +
  `</mc:AlternateContent>`;
const morph = `<mc:AlternateContent xmlns:mc="${MC}"><mc:Choice xmlns:p14="${P14}" ` +
  `xmlns:p159="${P159}" Requires="p159"><p:transition p14:dur="1600">` +
  `<p159:morph option="byWord"/></p:transition></mc:Choice><mc:Fallback>` +
  `<p:transition spd="med"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>`;
const timing = '<p:timing xmlns:fixture="urn:web-ppt:transition-fixture" fixture:keep="timing"><p:tnLst/></p:timing>';
const unrelatedMce = `<mc:AlternateContent xmlns:mc="${MC}"><mc:Choice xmlns:p14="${P14}" Requires="p14">` +
  '<p:extLst><p:ext uri="{TRANSITION-KEEP}"/></p:extLst></mc:Choice>' +
  '<mc:Fallback><p:extLst/></mc:Fallback></mc:AlternateContent>';
const unknownCarrier = '<fixture:transition><fixture:cut/></fixture:transition>';

const definitions = [null, ...standard.map(([type, attrs], index) => direct(type, attrs, index)),
  ...extended.map(([type, attrs], index) => alternate(type, attrs, index)), morph];
const slides = definitions.map((transition, index) => {
  const body = sp({
    x: 300, y: 230, w: 680, h: 220, name: `transition-${index}`,
    fill: '<a:solidFill><a:schemeClr val="accent1"/></a:solidFill>',
    text: label(index === 0 ? '无切换' : `切换 ${index}`, 3600, 'FFFFFF'),
  });
  const suffix = `${index === 1 ? unknownCarrier : ''}${transition ?? ''}`
    + `${index === 1 ? timing + unrelatedMce : ''}`;
  return slideXml(body, '', index === 1
    ? `xmlns:fixture="urn:web-ppt:transition-fixture" xmlns:mc="${MC}" `
      + 'mc:Ignorable="fixture" fixture:keep="root"' : '')
    .replace('</p:sld>', `${suffix}</p:sld>`);
});

const bytes = deck({ name: 'Editor Transitions', width: 1280, height: 720, slides });
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-transitions.pptx'), bytes);
console.log(`fixtures/sample-editor-transitions.pptx 已生成（${slides.length} 页，${(bytes.length / 1024).toFixed(1)} KB）`);
