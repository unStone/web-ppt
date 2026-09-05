import { unzipSync } from 'fflate';
import { makeZip } from './ooxml.mjs';

const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';

export function rewriteCompatibilityFixture(bytes, rewrite) {
  const parts = unzipSync(new Uint8Array(bytes));
  const part = 'ppt/slides/slide1.xml';
  parts[part] = new TextEncoder().encode(rewrite(new TextDecoder().decode(parts[part])));
  return makeZip(Object.entries(parts));
}

export async function runCompatibilitySelectionContract({ core, bytes, check, eq }) {
  const slide = new TextDecoder().decode(unzipSync(new Uint8Array(bytes))['ppt/slides/slide1.xml']);
  const picture = slide.match(/<mc:Fallback>([\s\S]*?)<\/mc:Fallback>/)[1];
  const pic = (id) => picture.replace('id="6"', `id="${id}"`);
  const choice = (requires, content, declarations = '') =>
    `<mc:Choice Requires="${requires}" ${declarations}>${content}</mc:Choice>`;
  const wrap = (content) => `<mc:AlternateContent xmlns:mc="${MC}" xmlns:known="${P14}" xmlns:future="urn:unknown">${content}</mc:AlternateContent>`;
  const fallback = `<mc:Fallback>${pic(6)}</mc:Fallback>`;
  const cases = [
    ['未知要求内即使是已知图片也不能抢占回退', choice('future', pic(7)) + fallback, 6],
    ['选择首个全部满足要求的 Choice', choice('future', pic(7)) + choice('known', pic(8)) + choice('known', pic(9)) + fallback, 8],
    ['多个 Requires 必须全部满足', choice('known future', pic(7)) + fallback, 6],
    ['未声明的命名空间前缀不能通过要求', choice('missing', pic(7)) + fallback, 6],
    ['分支局部命名空间遮蔽父级绑定', choice('known', pic(7), 'xmlns:known="urn:unknown"') + fallback, 6],
    ['空 Requires 不能声明能力', choice('', pic(7)) + fallback, 6],
    ['有意留空的已支持 Choice 不被回退填回', choice('known', '') + fallback, null],
    ['要求中的 XML 空白不改变能力判断', choice(' known\t known ', pic(7)) + fallback, 7],
  ];
  for (const [label, content, expectedId] of cases) {
    const variant = rewriteCompatibilityFixture(bytes, (xml) =>
      xml.replace(/<mc:AlternateContent[\s\S]*?<\/mc:AlternateContent>/, wrap(content)));
    const parsed = await core.parse(variant, { lazy: false, edit: true });
    try {
      eq(label, parsed.slides[0].elements[0]?.id ?? null, expectedId);
      eq(`${label}不输出额外分支`, parsed.slides[0].elements.length, expectedId === null ? 0 : 1);
    } finally { parsed.dispose?.(); }
  }
  const broken = rewriteCompatibilityFixture(bytes, (xml) => xml.replace('r:embed="rId3"', 'r:embed="missing"'));
  const missingImage = await core.parse(broken, { lazy: false, edit: true });
  try {
    eq('损坏的兼容图片仍保留明确占位', missingImage.slides[0].elements[0]?.kind, 'unsupported');
    check('损坏的兼容图片保留可定位框架', missingImage.slides[0].elements[0]?.id === 6
      && missingImage.slides[0].elements[0]?.w === 400);
  } finally { missingImage.dispose?.(); }
}
