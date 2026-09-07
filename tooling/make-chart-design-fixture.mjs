import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8, strToU8 } from 'fflate';
import { makeZip } from './lib/ooxml.mjs';

const parts = unzipSync(readFileSync(new URL('../fixtures/sample-chart-data.pptx', import.meta.url)));
const part = 'ppt/charts/chart1.xml';
parts[part] = strToU8(strFromU8(parts[part]).replace('</c:plotArea>', '<c:spPr><a:solidFill><a:srgbClr val="F7F9FC"/></a:solidFill></c:spPr></c:plotArea>')
  .replace('</c:chartSpace>', '<c:extLst><c:ext uri="urn:chart-design-fixture"><keep:data xmlns:keep="urn:chart-design-test">保留原扩展</keep:data></c:ext></c:extLst></c:chartSpace>'));
writeFileSync(new URL('../fixtures/sample-chart-design.pptx', import.meta.url), makeZip(Object.entries(parts)));
