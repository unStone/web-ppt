/** 交互序列（触发器动画）固件：主序列与交互序列并存、只有交互序列、只有主序列的对照页。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, label, nextShapeId, px, slideXml } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function shape({ x, y, w = 420, h = 150, color, name, text }) {
  const id = nextShapeId();
  return {
    id,
    xml: `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm>
<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/>${label(text, 2800, 'FFFFFF')}</p:txBody></p:sp>`,
  };
}

// 时间节点 id 在一页的 p:timing 内唯一；1 固定给 tmRoot
let timeId = 1;
const nextTimeId = () => ++timeId;
const targetEl = (target) => `<p:tgtEl><p:spTgt spid="${target}"/></p:tgtEl>`;

function visibility(target, value, delay) {
  return `<p:set><p:cBhvr><p:cTn id="${nextTimeId()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst></p:cTn>${targetEl(target)}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="${value}"/></p:to></p:set>`;
}

/** 淡入 / 淡出（presetID 10）：与 edit-core 保存时写出的规范结构一致 */
function fade({ target, kind, duration, delay = 0, nodeType }) {
  const entrance = kind === 'entr';
  const visual = `<p:animEffect transition="${entrance ? 'in' : 'out'}" filter="fade"><p:cBhvr><p:cTn id="${nextTimeId()}" dur="${duration}" fill="hold"/>${targetEl(target)}</p:cBhvr></p:animEffect>`;
  // 入场先置可见再揭开，退场先淡出再藏起
  const behaviors = entrance ? `${visibility(target, 'visible', 0)}${visual}` : `${visual}${visibility(target, 'hidden', duration)}`;
  return `<p:par><p:cTn id="${nextTimeId()}" presetID="10" presetClass="${kind}" dur="${duration}" fill="hold" nodeType="${nodeType}"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst><p:childTnLst>${behaviors}</p:childTnLst></p:cTn></p:par>`;
}

/** 强调旋转（presetID 61）：绕中心转一整圈 */
function spin({ target, duration, delay = 0, nodeType }) {
  return `<p:par><p:cTn id="${nextTimeId()}" presetID="61" presetClass="emph" dur="${duration}" fill="hold" nodeType="${nodeType}"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst><p:childTnLst><p:animRot by="21600000"><p:cBhvr><p:cTn id="${nextTimeId()}" dur="${duration}" fill="hold"/>${targetEl(target)}<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot></p:childTnLst></p:cTn></p:par>`;
}

/** 主序列的点击批次：等一次点击才开始 */
const clickGroup = (effects) =>
  `<p:par><p:cTn id="${nextTimeId()}" fill="hold" nodeType="clickEffect"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>${effects}</p:childTnLst></p:cTn></p:par>`;

const mainSequence = (groups) =>
  `<p:seq concurrent="1" nextAc="seek"><p:cTn id="${nextTimeId()}" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${groups}</p:childTnLst></p:cTn></p:seq>`;

/** 交互序列的点击批次：点击触发形状才开始（PowerPoint 写法：clickPar > withGroup > 效果） */
const interactiveGroup = (effects) =>
  `<p:par><p:cTn id="${nextTimeId()}" fill="hold" nodeType="clickPar"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="${nextTimeId()}" fill="hold" nodeType="withGroup"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${effects}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`;

/**
 * 交互序列：启动条件是点击 trigger，结构与 PowerPoint 一致（stCondLst 的 onClick、endSync、nextCondLst）。
 * restart 决定序列播放中再点触发形状的行为：always 立即重播，whenNotActive 忽略，never 播完后不再响应。
 */
const interactiveSequence = ({ trigger, restart, groups }) =>
  `<p:seq concurrent="1" nextAc="seek"><p:cTn id="${nextTimeId()}" restart="${restart}" fill="hold" evtFilter="cancelBubble" nodeType="interactiveSeq"><p:stCondLst><p:cond evt="onClick" delay="0">${targetEl(trigger)}</p:cond></p:stCondLst><p:endSync evt="end" delay="0"><p:rtn val="all"/></p:endSync><p:childTnLst>${groups}</p:childTnLst></p:cTn><p:nextCondLst><p:cond evt="onClick" delay="0">${targetEl(trigger)}</p:cond></p:nextCondLst></p:seq>`;

const timing = (sequences) =>
  `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>${sequences}</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;

// 页 1：主序列一批 + 两个交互序列。reveal 在触发前隐藏；badge 自己是触发形状，点两次后不再响应。
const title = shape({ x: 160, y: 90, color: '2E75B6', name: 'trigger-title', text: '触发器动画' });
const button = shape({ x: 160, y: 300, color: 'C55A11', name: 'trigger-button', text: '显示答案' });
const reveal = shape({ x: 700, y: 300, color: '548235', name: 'trigger-reveal', text: '答案' });
const badge = shape({ x: 160, y: 520, w: 240, h: 110, color: '7030A0', name: 'trigger-badge', text: '徽标' });
const slide1 = slideXml(`${title.xml}${button.xml}${reveal.xml}${badge.xml}`).replace(
  '</p:sld>',
  `${timing(
    mainSequence(clickGroup(fade({ target: title.id, kind: 'entr', duration: 400, nodeType: 'clickEffect' })))
      + interactiveSequence({
        trigger: button.id,
        restart: 'whenNotActive',
        groups: interactiveGroup(fade({ target: reveal.id, kind: 'entr', duration: 500, nodeType: 'clickEffect' })),
      })
      + interactiveSequence({
        trigger: badge.id,
        restart: 'never',
        groups:
          interactiveGroup(spin({ target: badge.id, duration: 600, nodeType: 'clickEffect' }))
          + interactiveGroup(fade({ target: badge.id, kind: 'exit', duration: 300, nodeType: 'clickEffect' })),
      }),
  )}</p:sld>`,
);
timeId = 1;

// 页 2：只有交互序列、没有主序列（答题类课件的常见写法）；restart=always，播放中再点会从头重播。
const choice = shape({ x: 160, y: 190, color: 'BF8F00', name: 'trigger-choice', text: '选项' });
const answer = shape({ x: 700, y: 190, color: 'C00000', name: 'trigger-answer', text: '正确' });
const slide2 = slideXml(`${choice.xml}${answer.xml}`).replace(
  '</p:sld>',
  `${timing(
    interactiveSequence({
      trigger: choice.id,
      restart: 'always',
      groups: interactiveGroup(
        fade({ target: answer.id, kind: 'entr', duration: 300, nodeType: 'clickEffect' })
          + spin({ target: answer.id, duration: 400, delay: 200, nodeType: 'afterEffect' }),
      ),
    }),
  )}</p:sld>`,
);
timeId = 1;

// 页 3：只有规范主序列的对照页，行为与交互序列无关。
const solo = shape({ x: 360, y: 260, color: '4472C4', name: 'trigger-solo', text: '仅主序列' });
const slide3 = slideXml(solo.xml).replace(
  '</p:sld>',
  `${timing(mainSequence(clickGroup(fade({ target: solo.id, kind: 'entr', duration: 400, nodeType: 'clickEffect' }))))}</p:sld>`,
);

const bytes = deck({ name: 'Animation Trigger', width: 1280, height: 720, slides: [slide1, slide2, slide3] });
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-animation-trigger.pptx'), bytes);
console.log(`fixtures/sample-animation-trigger.pptx 已生成（3 页，${(bytes.length / 1024).toFixed(1)} KB）`);
