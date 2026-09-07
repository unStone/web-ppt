import { deflateSync } from 'fflate';
import { chartXml } from './chartex-native-fixture.mjs';
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
// 固件从已知经纬顶点编码；断言使用原坐标，不调用被测解码器生成期望值。
export function encodeRing(points) {
 let x=0,y=0,text='';
 for(const[lon,lat]of points){const nx=Math.round(lon*1e5),ny=Math.round(lat*1e5),dx=nx-x,dy=ny-y;x=nx;y=ny;const a=dx<0?-2*dx-1:2*dx,b=dy<0?-2*dy-1:2*dy;let n=(a+b)*(a+b+1)/2+b;do{const digit=n%32;n=Math.floor(n/32);text+=alphabet[digit+(n?32:0)];}while(n);}
 return text;
}
export const rings=[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[2,2],[2,4],[4,4],[4,2],[2,2]],[[15,0],[25,0],[25,10],[15,10],[15,0]]];
export function mapXml({binary=false,projection='mercator',antimeridian=false}={}) {
 const transform=ring=>ring.map(([x,y])=>[antimeridian?(x+170>180?x-190:x+170):x,y]);
 const polygon=(ids,parts)=>parts.map((ring,i)=>`<cx:geoPolygon polygonId="${ids+i}" numPoints="${ring.length}" pcaRings="1,${encodeRing(transform(ring))}"/>`).join('');
 const clear=`<cx:clear xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex"><cx:geoDataEntityQueryResults><cx:geoDataEntityQueryResult><cx:geoData entityId="west" entityName="West" east="10" west="0" north="10" south="0"><cx:geoPolygons>${polygon(1,rings.slice(0,2))}</cx:geoPolygons><cx:copyrights><cx:copyright>Test boundaries</cx:copyright></cx:copyrights></cx:geoData></cx:geoDataEntityQueryResult><cx:geoDataEntityQueryResult><cx:geoData entityId="east" entityName="East" east="25" west="15" north="10" south="0"><cx:geoPolygons>${polygon(3,rings.slice(2))}</cx:geoPolygons></cx:geoData></cx:geoDataEntityQueryResult></cx:geoDataEntityQueryResults></cx:clear>`;
 const cache=binary?'<cx:binary>'+Buffer.from(deflateSync(new TextEncoder().encode(clear))).toString('base64')+'</cx:binary>':clear;
 return chartXml('regionMap',{values:[10,70],categories:[['West','East']],layout:`<cx:geography projectionType="${projection}" cultureLanguage="en-US" cultureRegion="US" attribution="Synthetic geometry fixture"><cx:geoCache provider="local-test">${cache}</cx:geoCache></cx:geography>`}).replace('<cx:numDim type="val">','<cx:numDim type="colorVal">');
}
