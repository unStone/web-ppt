import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { makeZip } from './lib/ooxml.mjs';
import { example } from './lib/emf-plus-fixture.mjs';
const parts = unzipSync(readFileSync(new URL('../fixtures/sample-metafile.pptx', import.meta.url)));
parts['ppt/media/image1.emf'] = example();
parts['ppt/media/image2.wmf'] = example({dual:true});
writeFileSync(new URL('../fixtures/sample-emf-plus.pptx',import.meta.url),makeZip(Object.entries(parts)));
console.log('EMF+ 固件：Only/Dual、路径、透明色、渐变、裁剪、图片与文本');
