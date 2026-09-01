import { basename } from 'node:path';

function escaped(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function position(markup, text) {
  const match = markup.match(new RegExp(
    `<tspan class="TextPosition" x="([\\d.]+)" y="([\\d.]+)"><tspan[^>]*font-size="([\\d.]+)px"[^>]*>${escaped(text)}</tspan>`,
  ));
  if (!match) throw new Error(`LibreOffice SVG 缺少项目符号文字：${text}`);
  return { x: Number(match[1]), y: Number(match[2]), size: Number(match[3]) };
}

function runFormatOracle(markup) {
  const first = position(markup, '一级一');
  const none = position(markup, '一级二');
  const roman = position(markup, 'v.');
  const romanText = position(markup, '二级符号');
  const reset = position(markup, '1.');
  const resetText = position(markup, '一级三');
  const level3 = position(markup, '三级编号一');
  const firstList = markup.match(
    /ooo:numbering-type="bullet-style"[^>]*>[\s\S]*?<tspan id="([^"]+)" class="BulletPlaceholder"\/>[\s\S]*?>一级一<\/tspan>/,
  );
  const bullet = firstList && markup.match(new RegExp(
    `id="bullet-char-${escaped(firstList[1])}"[\\s\\S]*?translate\\(([\\d.]+),([\\d.]+)\\)`
      + '[\\s\\S]*?fill="rgb\\(29,78,216\\)"',
  ));
  const noneIsPlain = /<tspan class="TextParagraph">[\s\S]*?>一级二<\/tspan>/.test(markup);
  const evidence = {
    bulletGap: first.x - Number(bullet?.[1]),
    noneAlign: none.x - Number(bullet?.[1]),
    romanGap: romanText.x - roman.x,
    resetGap: resetText.x - reset.x,
    levelIndent: level3.x - first.x,
    sizeRatio: first.size / level3.size,
  };
  if (!bullet || !noneIsPlain
    || evidence.bulletGap < 700 || evidence.bulletGap > 1000
    || Math.abs(evidence.noneAlign) > 2
    || Math.abs(roman.y - romanText.y) > 2 || roman.size !== romanText.size
    || Math.abs(reset.y - resetText.y) > 2 || reset.size !== resetText.size
    || evidence.romanGap < 400 || evidence.romanGap > 800
    || evidence.resetGap < 500 || evidence.resetGap > 900
    || evidence.levelIndent < 2000 || evidence.levelIndent > 2600
    || Math.abs(evidence.sizeRatio - 4 / 3) > 0.03) {
    throw new Error(`LibreOffice 项目符号文字几何无效：${JSON.stringify(evidence)}`);
  }
  return `，字符/none/roman/reset 文字基线与缩进成立，三级缩进差 ${evidence.levelIndent.toFixed(0)} unit`;
}

function runImageOracle(markup) {
  const text = position(markup, '继承自动编号');
  const list = markup.match(
    /ooo:numbering-type="image-style"[^>]*>[\s\S]*?x="([\d.]+)" y="([\d.]+)"[\s\S]*?<tspan id="([^"]+)" class="BitmapPlaceholder"\/>[\s\S]*?>继承自动编号<\/tspan>/,
  );
  const embeddedId = list?.[3].replace('bitmap-placeholder', 'bitmap');
  const use = list && markup.match(new RegExp(
    `id="embedded-${escaped(embeddedId)}"[\\s\\S]*?<use x="([\\d.]+)" y="([\\d.]+)" xlink:href="#bitmap\\([^)]+\\)"`,
  ));
  const plainNone = /<tspan class="TextParagraph">[\s\S]*?>显式无项目符号<\/tspan>/.test(markup);
  const imageCount = markup.match(/ooo:numbering-type="image-style"/g)?.length ?? 0;
  const bitmapCount = markup.match(/class="EmbeddedBitmap"/g)?.length ?? 0;
  const gap = text.x - Number(list?.[1]);
  if (!list || !use || !plainNone || imageCount < 2 || bitmapCount < 2
    || gap < 450 || gap > 700
    || Math.abs(Number(use[1]) - Number(list[1])) > 2
    || Math.abs(Number(use[2]) - Number(list[2])) > 2) {
    throw new Error(`LibreOffice 图片项目符号几何无效：${JSON.stringify({
      imageCount, bitmapCount, gap, list, use,
    })}`);
  }
  return `，${imageCount} 个图片列表项与嵌入位图坐标一致、显式 none 无占位`;
}

function runGeneratedOracle(markup) {
  const charText = position(markup, '字符列表');
  const auto = position(markup, 'iv.');
  const autoText = position(markup, '自动编号');
  const imageText = position(markup, '图片列表');
  const imageLists = markup.match(/ooo:numbering-type="image-style"/g)?.length ?? 0;
  const charLists = markup.match(/ooo:numbering-type="bullet-style"/g)?.length ?? 0;
  if (imageLists !== 1 || charLists !== 1
    || !markup.includes('class="EmbeddedBitmap"')
    || !(charText.y < autoText.y && autoText.y < imageText.y)
    || Math.abs(auto.y - autoText.y) > 2
    || autoText.x <= auto.x) {
    throw new Error(`LibreOffice 生成项目符号几何无效：${JSON.stringify({
      imageLists, charLists, charText, auto, autoText, imageText,
    })}`);
  }
  return '，生成式字符/iv. 自动编号/图片三行均有独立列表几何';
}

/** 项目符号必须由真实 Office 证明可打开，并验证列表标记与正文的相对几何。 */
export function runBulletFormatLibreOfficeContract({ savedPath, exportSvg }) {
  const name = basename(savedPath);
  const markup = exportSvg('项目符号文字几何');
  if (name === 'bullet-format-editing.pptx') return runFormatOracle(markup);
  if (name === 'bullet-image-editing.pptx') return runImageOracle(markup);
  if (name === 'generated-bullets.pptx') return runGeneratedOracle(markup);
  return '';
}
