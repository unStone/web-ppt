import { deck, makePng, NS, px, slideXml, XML } from './ooxml.mjs';
export const CX = 'http://schemas.microsoft.com/office/drawing/2014/chartex';
export const kinds = ['treemap', 'sunburst', 'histogram', 'pareto', 'boxWhisker', 'waterfall', 'funnel', 'regionMap'];
const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const level = (values) => `<cx:lvl ptCount="${values.length}">${values.flatMap((v, i) => v === null ? [] : [`<cx:pt idx="${i}">${escape(v)}</cx:pt>`]).join('')}</cx:lvl>`;
export function chartXml(kind, options = {}) {
  const hierarchical = kind === 'treemap' || kind === 'sunburst';
  const values = options.values ?? (hierarchical ? [8, 4, 6, 5, 3, 2] : kind === 'waterfall' ? [10, -3, 6, -2, 11] : [1, 1, 2, 3, 3, 3, 4, 4, 5, 8]);
  const categories = options.categories ?? (hierarchical ? [['A', 'B', 'A', 'A', 'C', null], ['Alpha', null, 'Beta', 'Alpha', null, 'Beta'], ['North', null, null, 'South', null, null]] : [values.map((_, i) => `Point ${i + 1}`)]);
  const dims = (vals) => `<cx:strDim type="cat">${categories.map(level).join('')}</cx:strDim><cx:numDim type="${hierarchical ? 'size' : 'val'}">${level(vals)}</cx:numDim>`;
  const count = kind === 'boxWhisker' ? 3 : 1;
  const data = Array.from({ length: count }, (_, i) => `<cx:data id="${i}">${dims(values.map((v) => v === null ? null : v + i))}</cx:data>`).join('');
  const layout = kind === 'histogram' || kind === 'pareto' ? 'clusteredColumn' : kind;
  const layoutProps = options.layout ?? (kind === 'histogram' || kind === 'pareto' ? '<cx:binning intervalClosed="r"><cx:binSize>2</cx:binSize></cx:binning>' : kind === 'boxWhisker' ? '<cx:statistics quartileMethod="exclusive"/>' : kind === 'waterfall' ? '<cx:subtotals><cx:idx val="0"/><cx:idx val="4"/></cx:subtotals>' : '');
  const series = Array.from({ length: count }, (_, i) => `<cx:series layoutId="${layout}" formatIdx="${i}"><cx:tx><cx:txData><cx:v>Series ${i + 1}</cx:v></cx:txData></cx:tx><cx:dataId val="${i}"/><cx:layoutPr>${layoutProps}</cx:layoutPr></cx:series>`).join('');
  return `${XML}<cx:chartSpace xmlns:cx="${CX}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><cx:chartData>${data}</cx:chartData><cx:chart><cx:title><cx:tx><cx:rich><a:bodyPr/><a:p><a:r><a:t>${escape(kind)}</a:t></a:r></a:p></cx:rich></cx:tx></cx:title><cx:plotArea><cx:plotAreaRegion>${series}${kind === 'pareto' ? '<cx:series layoutId="paretoLine" ownerIdx="0"/>' : ''}</cx:plotAreaRegion></cx:plotArea></cx:chart></cx:chartSpace>`;
}
/** 真实 Office 的 MC 外壳结构；所有数据与回退像素由仓库自行生成。 */
export function nativeFixture() {
  const image = makePng(24, 16, () => [40, 120, 200]);
  const slides = kinds.map((kind) => {
    const xf = `<a:off x="${px(30)}" y="${px(30)}"/><a:ext cx="${px(580)}" cy="${px(360)}"/>`;
    const frame = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="${kind}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm>${xf}</p:xfrm><a:graphic><a:graphicData uri="${CX}"><cx:chart xmlns:cx="${CX}" r:id="rId2"/></a:graphicData></a:graphic></p:graphicFrame>`;
    const pic = `<p:pic><p:nvPicPr><p:cNvPr id="6" name="${kind}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId3"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm>${xf}</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
    return slideXml(`<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:modern="http://schemas.microsoft.com/office/drawing/2015/10/21/chartex"><mc:Choice Requires="modern">${frame}</mc:Choice><mc:Fallback>${pic}</mc:Fallback></mc:AlternateContent>`);
  });
  return deck({ name: 'ChartEx native contract', width: 640, height: 420, slides,
    slideRelationships: kinds.map((_, i) => `<Relationship Id="rId2" Type="http://schemas.microsoft.com/office/2014/relationships/chartEx" Target="../charts/chartEx${i + 1}.xml"/><Relationship Id="rId3" Type="${NS.r}/image" Target="../media/chartex.png"/>`),
    extraTypes: '<Default Extension="png" ContentType="image/png"/>' + kinds.map((_, i) => `<Override PartName="/ppt/charts/chartEx${i + 1}.xml" ContentType="application/vnd.ms-office.chartex+xml"/>`).join(''),
    extraEntries: [...kinds.map((kind, i) => [`ppt/charts/chartEx${i + 1}.xml`, chartXml(kind)]), ['ppt/media/chartex.png', image]],
  });
}
