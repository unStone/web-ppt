import type { TextBody, TextRun } from '@web-ppt/core';
import { atom,color,rgba,concat,u16,u32,utf16 } from './binary';
export class FontTable {
  readonly names: string[] = ['Arial'];
  index(name: string): number {
    if (!name || name.length>31 || /[\0-\x1f]/.test(name)) throw new Error('PPT 字体名称必须为 1–31 个字符');
    let index=this.names.indexOf(name);if(index<0){if(this.names.length>=512)throw new Error('PPT 字体数量超限');index=this.names.length;this.names.push(name);}return index;
  }
  records(): Uint8Array[] {
    return this.names.map((name,i)=>{const body=new Uint8Array(68);body.set(utf16(name));body[64]=1;body[66]=1;body[67]=0;return atom(0x0fb7,body,0,i);});
  }
}
function character(run: TextRun,fonts:FontTable):Uint8Array {
  if(run.math||run.gradient||run.outline||run.shadow||run.underlineColor||run.field||run.highlight||run.spacing||run.caps&&run.caps!=='none'||run.strike||run.strikeType&&run.strikeType!=='noStrike'||run.link)throw new Error('此 PPT 写入器不能表示公式、链接或高级字符效果');
  if(rgba(run.color).alpha!==1)throw new Error('PPT 写入暂不支持半透明文字');
  if(run.underline&&run.underline!=='sng'&&run.underline!=='none')throw new Error('PPT 写入暂不支持此下划线样式');
  const size=Math.round(run.size*0.75);if(!Number.isFinite(size)||size<1||size>4000)throw new Error('PPT 字号超限');
  const flags=Number(run.b)|(Number(run.i)<<1)|(Number(run.u)<<2);
  return concat([u32(0x002f0007),u16(flags),u16(fonts.index(run.fonts[0]||'Arial')),u16(fonts.index(run.fonts[1]||run.fonts[0]||'Arial')),u16(size),u32(color(run.color)|0xfe000000),u16(Math.round(run.baseline??0))]);
}

/** 字符覆盖含段落末尾的 CR；最后一段还必须覆盖隐含的终止字符。 */
export function textRecords(body: TextBody,fonts:FontTable,type=4):Uint8Array {
  if(body.warp||body.vert&&body.vert!=='horz'||(body.columns??1)!==1)throw new Error('PPT 写入暂不支持艺术字、竖排或多栏文字');
  if(body.fontScale!==1||body.autoFitCompute||body.autoFitNormal||body.autoFitShape||body.lnSpcReduction||body.anchorCtr)throw new Error('PPT 写入暂不支持自动适应或文字框居中语义');
  const text=body.paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\r');
  if(/[\0]/.test(text))throw new Error('PPT 文字不能包含 NUL');
  const para:Uint8Array[]=[],chars:Uint8Array[]=[];
  for(const p of body.paragraphs){
    if(p.rtl||p.bulletColor||p.bulletFont||p.bulletSize&&p.bulletSize!==1||p.editInfo?.autoNumbering)throw new Error('PPT 写入暂不支持段落方向或独立项目符号样式');
    if(!Number.isInteger(p.lvl)||p.lvl<0||p.lvl>4)throw new Error('PPT 段落级别必须在 0–4 之间');
    if([p.marL,p.indent,p.spaceBefore,p.spaceAfter].some(n=>!Number.isFinite(n)||Math.abs(n*6)>32767)||p.lineHeight!==null&&(!Number.isFinite(p.lineHeight)||Math.abs(p.lineHeight*(p.lineHeight<0?6:100))>32767))throw new Error('PPT 段落间距超限');
    const length=p.runs.reduce((sum,r)=>sum+r.text.length,0)+1;
    const bullet=p.bullet,bulletOn=bullet!==null&&bullet!=='';
    if(bulletOn&&bullet!.length!==1||p.bulletImage)throw new Error('PPT 写入暂不支持此项目符号');
    const mask=0x00007d0f|(bulletOn?0x80:0);
    const line=p.lineHeight===null||p.lineHeight===undefined?100:p.lineHeight<0?Math.round(p.lineHeight*6):Math.round(p.lineHeight*100);
    const values=[u32(length),u16(p.lvl??0),u32(mask),u16(bulletOn?1:0),...(bulletOn?[u16(bullet!.charCodeAt(0))]:[]),u16(({left:0,center:1,right:2,justify:3,dist:4} as Record<string,number>)[p.align]??0),u16(line),u16(-Math.round((p.spaceBefore??0)*6)),u16(-Math.round((p.spaceAfter??0)*6)),u16(Math.round((p.marL??0)*6)),u16(Math.round((p.indent??0)*6))];
    para.push(concat(values));
    for(let i=0;i<p.runs.length;i++){
      const run=p.runs[i],count=run.text.length+(i===p.runs.length-1?1:0);
      if(count)chars.push(concat([u32(count),character(run,fonts)]));
    }
    if(!p.runs.length)chars.push(concat([u32(1),u32(0)]));
  }
  if(!body.paragraphs.length){para.push(concat([u32(1),u16(0),u32(0)]));chars.push(concat([u32(1),u32(0)]));}
  return concat([atom(0x0f9f,u32(type)),atom(0x0fa0,utf16(text)),atom(0x0fa1,concat([...para,...chars]))]);
}
export function defaultTextStyle(type:number):Uint8Array {
  return atom(0x0fa3,concat([u16(1),...(type>=5?[u16(0)]:[]),u32(0),u32(0x00030000),u16(0),u16(18)]),0,type);
}
