import { deck, makePng, NS, px, slideXml, solid } from '../lib/ooxml.mjs';
import { getTask, FONT_FAMILY, TITLE_NAME } from './tasks.mjs';

const BODY = 'Product progress remains visible. The team completed the planned work and keeps the original wording for this evaluation. Review the image and the planning card, then update the title without removing any content.';
const PROMPT = 'Click to edit title';
const DARK = '202020';
const xfrm = ([x, y, w, h]) => `<a:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm>`;

function text(value, size, color = DARK, eastAsia = FONT_FAMILY) {
  return `<a:p><a:pPr><a:buNone/></a:pPr><a:r><a:rPr lang="en-US" sz="${size}">
${solid(color)}<a:latin typeface="${FONT_FAMILY}"/><a:ea typeface="${eastAsia}"/><a:cs typeface="${FONT_FAMILY}"/>
</a:rPr><a:t>${value}</a:t></a:r><a:endParaRPr lang="en-US" sz="${size}"/></a:p>`;
}

function shape({ id, name, rect, value, size, color = DARK, fill, placeholder = false, eastAsia }) {
  // 固定 OOXML 身份使同进程多次生成不受共享 shapeId 计数器影响。
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr>${placeholder ? '<p:ph type="title" idx="0"/>' : ''}</p:nvPr></p:nvSpPr>
<p:spPr>${xfrm(rect)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill ? solid(fill) : '<a:noFill/>'}<a:ln><a:noFill/></a:ln></p:spPr>
<p:txBody><a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0" anchor="t" wrap="square"><a:noAutofit/></a:bodyPr><a:lstStyle/>
${text(value, size, color, eastAsia)}</p:txBody></p:sp>`;
}

function picture(rect) {
  return `<p:pic><p:nvPicPr><p:cNvPr id="4" name="Evaluation image" descr="Original evaluation image"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="evaluationImage"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr>${xfrm(rect)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

function build(id, reference) {
  const task = getTask(id);
  const defect = reference ? 'clean' : task.kind;
  const title = shape({ id: 2, name: TITLE_NAME, rect: [40, 25, 640, 60], placeholder: true,
    value: reference ? task.expectedTitle : defect === 'placeholder-prompt-left' ? PROMPT : 'Draft quarterly report',
    size: 2800, color: defect === 'low-contrast' ? 'F5F5F5' : DARK,
    eastAsia: defect === 'missing-font' ? 'Unavailable Evaluation CJK' : FONT_FAMILY });
  const body = shape({ id: 3, name: 'Evaluation body', rect: [40, 110, 360, defect === 'text-overflow' ? 30 : 250],
    value: BODY, size: 1800 });
  const image = picture([460, 120, 180, defect === 'image-distorted' ? 180 : 90]);
  const cardRect = defect === 'element-overlap' ? [80, 130, 180, 65]
    : defect === 'off-canvas' ? [650, 320, 180, 65] : [460, 320, 180, 65];
  const card = shape({ id: 5, name: 'Evaluation card', rect: cardRect,
    value: 'Planning card', size: 1600, fill: 'F2F2F2' });
  const layoutTitle = shape({ id: 2, name: 'Layout title', rect: [40, 25, 640, 60],
    value: PROMPT, size: 2800, placeholder: true });
  return deck({ name: 'Agent Evaluation', width: 720, height: 405,
    slides: [slideXml(title + body + image + card)], layoutShapes: layoutTitle,
    slideRelationships: [`<Relationship Id="evaluationImage" Type="${NS.r}/image" Target="../media/evaluation.png"/>`],
    extraTypes: '<Default Extension="png" ContentType="image/png"/>',
    extraEntries: [['ppt/media/evaluation.png', makePng(80, 40, (x, y) => [30 + x * 2, 50 + y * 3, 180])]],
  });
}

export function buildFixture(taskId) { return build(taskId, false); }
export function buildReferenceSolution(taskId) { return build(taskId, true); }
