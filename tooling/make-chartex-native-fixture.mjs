import { writeFileSync } from 'node:fs';
import { nativeFixture } from './lib/chartex-native-fixture.mjs';

writeFileSync(new URL('../fixtures/sample-chartex-native.pptx',import.meta.url),nativeFixture());
console.log('ChartEx 原生布局固件已生成（人工边界，不冒充 Office 原文件）');
