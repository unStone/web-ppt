import { parse, setChartExParser, type ChartEnv, type ChartParser } from '@web-ppt/core';
import { parseChartEx, renderChartExXml } from '@web-ppt/core/chart-ex';

const parser: ChartParser = parseChartEx;
setChartExParser(parser);
void parse(new Uint8Array(), { edit: true, keepPackage: true });
setChartExParser(null);
declare const environment: ChartEnv;
renderChartExXml('<chartSpace/>', 640, 360, environment);
// @ts-expect-error hook 只能接受 Schema 解析器
setChartExParser(() => '<svg/>');
