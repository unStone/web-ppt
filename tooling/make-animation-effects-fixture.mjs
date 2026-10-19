import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, label, nextShapeId, px, slideXml } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const groups = [
  [
    ['appear', 1, 0, ''], ['fade', 10, 0, 'fade'],
    ['fly-bottom', 2, 4, 'slide(fromBottom)'], ['fly-left', 2, 8, 'slide(fromLeft)'],
    ['wipe-up', 22, 1, 'wipe(up)'], ['zoom', 23, 16, 'scale'],
    ['box-in', 4, 16, 'box(in)'], ['box-out', 4, 32, 'box(out)'],
  ],
  [
    ['blinds-h', 3, 5, 'blinds(horizontal)'], ['blinds-v', 3, 10, 'blinds(vertical)'],
    ['checker-across', 5, 5, 'checkerboard(across)'], ['checker-down', 5, 10, 'checkerboard(down)'],
    ['random-bars-h', 14, 5, 'randombar(horizontal)'], ['random-bars-v', 14, 10, 'randombar(vertical)'],
    ['strips-dl', 18, 12, 'strips(downLeft)'], ['strips-ul', 18, 9, 'strips(upLeft)'],
  ],
  [
    ['strips-dr', 18, 3, 'strips(downRight)'], ['strips-ur', 18, 6, 'strips(upRight)'],
    ['circle-in', 6, 16, 'circle(in)'], ['circle-out', 6, 32, 'circle(out)'],
    ['diamond-in', 8, 16, 'diamond(in)'], ['diamond-out', 8, 32, 'diamond(out)'],
    ['plus-in', 13, 16, 'plus(in)'], ['plus-out', 13, 32, 'plus(out)'],
  ],
  [
    ['split-out-v', 16, 42, 'barn(outVertical)'], ['split-in-v', 16, 26, 'barn(inVertical)'],
    ['split-out-h', 16, 37, 'barn(outHorizontal)'], ['wheel-1', 21, 1, 'wheel(1)'],
    ['wheel-4', 21, 4, 'wheel(4)'], ['wheel-8', 21, 8, 'wheel(8)'],
    ['grow-turn', 31, 0, 'scale'], ['spin-in', 61, 0, 'rotation'],
  ],
  [
    ['float', 30, 0, 'slide(fromBottom)'], ['bounce', 26, 0, 'slide(fromTop)'],
    ['dissolve', 9, 0, 'dissolve'], ['stretch', 17, 10, 'scale'],
    ['swivel', 19, 0, 'rotation'], ['random', 24, 0, 'fade'],
  ],
  [
    ['exit-circle', 6, 16, 'circle(in)', 'exit'],
    ['exit-checker', 5, 5, 'checkerboard(across)', 'exit'],
    ['exit-wheel', 21, 4, 'wheel(4)', 'exit'],
    ['exit-split', 16, 42, 'barn(outVertical)', 'exit'],
    ['exit-box', 23, 16, 'box(in)', 'exit'],
    ['emphasis-opacity', 62, 0, 'fade', 'emph'],
  ],
  // PowerPoint 实际写出的伸展 / 挥舞：没有 animScale / animRot，只有 ppt_* 属性动画。
  [
    ['stretch-across', 17, 10, 'ppt-stretch'], ['stretch-bottom', 17, 4, 'ppt-stretch'],
    ['stretch-left', 17, 8, 'ppt-stretch'], ['stretch-top', 17, 1, 'ppt-stretch'],
    ['stretch-right', 17, 2, 'ppt-stretch'], ['swivel-vert', 19, 10, 'ppt-swivel'],
    ['swivel-horz', 19, 5, 'ppt-swivel'], ['exit-stretch-bottom', 17, 4, 'ppt-stretch', 'exit'],
  ],
];

const STRETCH_ANCHOR = {
  10: ['#ppt_x', '#ppt_y', '0', '#ppt_h'],
  4: ['#ppt_x', '#ppt_y+#ppt_h/2', '#ppt_w', '0'],
  1: ['#ppt_x', '#ppt_y-#ppt_h/2', '#ppt_w', '0'],
  8: ['#ppt_x-#ppt_w/2', '#ppt_y', '0', '#ppt_h'],
  2: ['#ppt_x+#ppt_w/2', '#ppt_y', '0', '#ppt_h'],
};

function propertyAnim(id, target, name, from, to, formula) {
  const value = (raw) => /^[0-9.]+$/.test(raw) ? `<p:fltVal val="${raw}"/>` : `<p:strVal val="${raw}"/>`;
  return `<p:anim calcmode="lin" valueType="num"><p:cBhvr><p:cTn id="${id}" dur="1200" fill="hold"/><p:tgtEl><p:spTgt spid="${target}"/></p:tgtEl><p:attrNameLst><p:attrName>${name}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"${formula ? ` fmla="${formula}"` : ''}><p:val>${value(from)}</p:val></p:tav><p:tav tm="100000"><p:val>${value(to)}</p:val></p:tav></p:tavLst></p:anim>`;
}

function powerPointBody(filter, subtype, kind, target, index) {
  const id = index * 10 + 200;
  if (filter === 'ppt-swivel') {
    const turning = subtype === 5 ? 'ppt_h' : 'ppt_w';
    const fixed = subtype === 5 ? 'ppt_w' : 'ppt_h';
    return propertyAnim(id, target, turning, '0', '1', `#${turning}*sin(2.5*pi*$)`)
      + propertyAnim(id + 1, target, fixed, `#${fixed}`, `#${fixed}`)
      + `<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="${id + 2}" dur="1200"/><p:tgtEl><p:spTgt spid="${target}"/></p:tgtEl></p:cBhvr></p:animEffect>`;
  }
  // 退场把起止对调：从原尺寸缩回同一条边。
  const pair = (from, to) => kind === 'exit' ? [to, from] : [from, to];
  const [x, y, w, h] = STRETCH_ANCHOR[subtype];
  return propertyAnim(id, target, 'ppt_x', ...pair(x, '#ppt_x'))
    + propertyAnim(id + 1, target, 'ppt_y', ...pair(y, '#ppt_y'))
    + propertyAnim(id + 2, target, 'ppt_w', ...pair(w, '#ppt_w'))
    + propertyAnim(id + 3, target, 'ppt_h', ...pair(h, '#ppt_h'));
}

function shape(index, entry) {
  const id = nextShapeId();
  const x = 45 + (index % 4) * 300;
  const y = 100 + Math.floor(index / 4) * 310;
  const [name] = entry;
  const xml = `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(230)}" cy="${px(140)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/>${label(name, 2200, 'FFFFFF')}</p:txBody></p:sp>`;
  return { id, xml };
}

function effect(entry, target, index) {
  const [name, preset, subtype, filter, kind = 'entr'] = entry;
  const scaleFrom = name === 'stretch' ? 20000 : 0;
  const body = filter.startsWith('ppt-')
    ? powerPointBody(filter, subtype, kind, target, index)
    : filter === ''
    ? `<p:set><p:cBhvr><p:cTn id="${index + 200}" dur="1"/><p:tgtEl><p:spTgt spid="${target}"/></p:tgtEl></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>`
    : filter === 'scale'
    ? `<p:animScale><p:cBhvr><p:cTn id="${index + 200}" dur="1200"/><p:tgtEl><p:spTgt spid="${target}"/></p:tgtEl></p:cBhvr><p:from x="${scaleFrom}" y="${scaleFrom}"/><p:to x="100000" y="100000"/></p:animScale>${name === 'grow-turn' ? `<p:animRot by="5400000"><p:cBhvr><p:cTn id="${index + 300}" dur="1200"/><p:tgtEl><p:spTgt spid="${target}"/></p:tgtEl></p:cBhvr></p:animRot>` : ''}`
    : filter === 'rotation'
      ? `<p:animRot by="10800000"><p:cBhvr><p:cTn id="${index + 200}" dur="1200"/><p:tgtEl><p:spTgt spid="${target}"/></p:tgtEl></p:cBhvr></p:animRot>`
      : `<p:animEffect transition="${kind === 'exit' ? 'out' : 'in'}" filter="${filter}"><p:cBhvr><p:cTn id="${index + 200}" dur="1200"/><p:tgtEl><p:spTgt spid="${target}"/></p:tgtEl></p:cBhvr></p:animEffect>`;
  const category = kind === 'exit' ? 'exit' : kind === 'emph' ? 'emph' : 'entr';
  return `<p:par><p:cTn id="${index + 10}" presetID="${preset}" presetSubtype="${subtype}" presetClass="${category}" nodeType="clickEffect" dur="1200" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${body}</p:childTnLst></p:cTn></p:par>`;
}

const slides = groups.map((entries) => {
  const shapes = entries.map((entry, index) => shape(index, entry));
  const timing = `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" nodeType="tmRoot"><p:childTnLst><p:seq><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${entries.map((entry, index) => effect(entry, shapes[index].id, index)).join('')}</p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
  return slideXml(shapes.map((item) => item.xml).join('')).replace('</p:sld>', `${timing}</p:sld>`);
});

const bytes = deck({ name: 'Animation Effects', width: 1280, height: 720, slides });
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-animation-effects.pptx'), bytes);
console.log(`fixtures/sample-animation-effects.pptx 已生成（${slides.length} 页）`);
