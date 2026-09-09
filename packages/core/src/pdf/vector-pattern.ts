import type {LiteElement} from '../xml-lite';
import {VectorDocument,pdfNumber as n} from './vector-document';
import {pathBounds} from './vector-bounds';
import type {VectorResources} from './vector-resources';

/** Form 的默认坐标与调用处一致，图案不会丢失对象 / 组的旋转缩放，也无需按面积展开重复单元。 */
export class VectorPattern {
  private patterns = new WeakMap<LiteElement,number>();
  private count = 0;
  constructor(private pdf:VectorDocument,private resources:VectorResources) {}
  async fill(path:string,pattern:LiteElement,evenOdd:boolean,draw:(child:LiteElement)=>Promise<string>):Promise<string> {
    const [left,top,w,h] = pathBounds(path); if (!w || !h) return '';
    const width = Number(pattern.getAttribute('width') ?? 0), height = Number(pattern.getAttribute('height') ?? 0);
    if (!width || !height) return '';
    if (width < 0 || height < 0 || pattern.getAttribute('patternUnits') !== 'userSpaceOnUse') throw new Error('PDF 图案单元无效');
    if (this.count >= 4096) throw new Error('PDF 图案资源超限');
    let tile = this.patterns.get(pattern);
    if (!tile) {
      const {commands,resources} = await this.resources.capture(async () => {
        const commands = ['q','1 w 0 J 0 j 4 M [] 0 d'];
        for (const child of pattern.children) commands.push(await draw(child));
        commands.push('Q'); return commands.join('\n');
      });
      const x = Number(pattern.getAttribute('x') ?? 0), y = Number(pattern.getAttribute('y') ?? 0);
      tile = this.pdf.stream(commands,`/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 2 /BBox [0 0 ${n(width)} ${n(height)}] /XStep ${n(width)} /YStep ${n(height)} /Matrix [1 0 0 1 ${n(x)} ${n(y)}] /Resources << ${resources} >>`);
      this.patterns.set(pattern,tile);
    }
    const object = this.pdf.stream(`/Pattern cs /P scn\n${path}\n${evenOdd ? 'f*' : 'f'}`,
      `/Type /XObject /Subtype /Form /BBox [${[left,top,left+w,top+h].map(n).join(' ')}] /Resources << /Pattern << /P ${tile} 0 R >> >>`);
    const name = `Pt${++this.count}`; this.resources.use('XObject',{name,object});
    return `q /${name} Do Q`;
  }
}
