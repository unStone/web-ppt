import {writeFileSync}from'node:fs';
import{unzipSync}from'fflate';
import{nativeFixture}from'./lib/chartex-native-fixture.mjs';
import{mapXml}from'./lib/region-map-fixture.mjs';
import{makeZip}from'./lib/ooxml.mjs';
const parts=unzipSync(nativeFixture());parts['ppt/charts/chartEx8.xml']=new TextEncoder().encode(mapXml({binary:true}));
writeFileSync(new URL('../fixtures/sample-region-map.pptx',import.meta.url),makeZip(Object.entries(parts)));
console.log('原生地图固件：压缩地理缓存、区域数值与反向内环');
