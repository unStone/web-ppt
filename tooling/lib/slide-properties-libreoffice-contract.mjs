import { roundtripSlideNotes } from './libreoffice-slide-roundtrip.mjs';

const decoder = new TextDecoder();
const attr = (source, name) => source
  .match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];

function pageLabel(xml) {
  const text = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
    .map((match) => match[1]).join('').replace(/\s+/g, '');
  return text.match(/页面属性(\d+)/)?.[1] ?? '';
}

/** 可见 SVG 验图案；同格式重存独立验证页序、隐藏位和 LO 可表达的背景语义。 */
export function runSlidePropertiesLibreOfficeContract({
  savedPath, out, root, soffice, exportSvg,
}) {
  const markup = exportSvg('页面背景');
  if (!markup.includes('rgb(5,46,22)') || !markup.includes('rgb(220,252,231)')) {
    throw new Error('LibreOffice SVG 没有渲染页面图案背景的前景色与背景色');
  }

  const roundtrip = roundtripSlideNotes({
    savedPath, out, root, soffice, name: 'slide-properties',
  });
  const slides = roundtrip.slideParts.map((part) => decoder.decode(roundtrip.parts[part]));
  const labels = slides.map(pageLabel);
  const hidden = slides.map((xml, index) =>
    attr(xml.match(/<p:sld\b([^>]*)>/)?.[1] ?? '', 'show') === '0' ? index : -1)
    .filter((index) => index >= 0);
  const gradient = slides[0]?.match(/<p:bg>[\s\S]*?<\/p:bg>/)?.[0] ?? '';
  const theme = slides[6]?.match(/<p:bg>[\s\S]*?<\/p:bg>/)?.[0] ?? '';
  const added = slides[7]?.match(/<p:bg>[\s\S]*?<\/p:bg>/)?.[0] ?? '';
  const evidence = {
    pages: slides.length === 8,
    order: JSON.stringify(labels) === JSON.stringify(['1', '2', '3', '3', '4', '5', '6', '']),
    hidden: JSON.stringify(hidden) === JSON.stringify([4, 7]),
    gradient: gradient.includes('<a:gradFill')
      && ['DBEAFE', '3B82F6', '1E3A8A'].every((color) => gradient.includes(`val="${color}"`))
      && gradient.includes('<a:alpha val="55000"/>'),
    theme: theme.includes('<a:solidFill><a:srgbClr val="70AD47"/></a:solidFill>'),
    added: added.includes('<a:solidFill><a:srgbClr val="FDE68A"/></a:solidFill>'),
  };
  if (!Object.values(evidence).every(Boolean)) {
    throw new Error(`LibreOffice 页面属性证据无效：${JSON.stringify({ ...evidence, labels, hidden })}`);
  }
  return '，图案背景像素通过，2 张隐藏页未进入 6 页 PDF；8 页顺序、隐藏位、渐变/主题/新增页背景经重存 XML 验证';
}
