import type {LiteElement} from '../xml-lite';
import {escapeXml} from '../render/serialize';
import {pdfNumber as n} from './vector-document';
import {identity,inverse,multiply,svgMatrix} from './vector-matrix';
import {VectorPdfError,vectorIssueLocation} from './vector-error';
import type {VectorImages} from './vector-images';
import type {VectorPdfIssue,VectorPdfOptions} from './vector-types';
import {VectorCoverage} from './vector-coverage';

function tag(el:LiteElement,body:string,attributes = el.attributes):string {
  return `<${el.tagName}${attributes.map(a => ` ${a.name}="${escapeXml(a.value)}"`).join('')}>${body}</${el.tagName}>`;
}
export class VectorFallback {
  private coverage:VectorCoverage;
  constructor(private root:LiteElement,private images:VectorImages,private options:VectorPdfOptions,
    private slideNumber:number,private issues:VectorPdfIssue[],private anonymous:ReadonlyMap<number,number[]>,definitions:ReadonlyMap<string,LiteElement>) {
    this.coverage = new VectorCoverage(definitions,root);
  }
  async render(el:LiteElement,ancestors:readonly LiteElement[],fontStyle:()=>Promise<string>):Promise<string | undefined> {
    const id = el.getAttribute('data-el'); if (id === null && ancestors.length) return;
    const reason = this.coverage.reason(el); if (!reason) return;
    const issue:VectorPdfIssue = {...vectorIssueLocation(this.slideNumber,id === null ? undefined : Number(id),this.anonymous),reason};
    // 无对象边界的页面背景不能退成整页图片；渲染失败也不能用占位框冒充原始内容。
    if (id === null || reason === 'svg-render-error' || !this.options.rasterize) throw new VectorPdfError(issue);
    const encoded = new Map<string,string>();
    const serialize = async (node:LiteElement):Promise<string> => {
      const children:string[] = [], attributes = [];
      for (const child of node.childNodes) children.push(typeof child === 'string' ? escapeXml(child) : await serialize(child));
      for (const attribute of node.attributes) {
        if (node.localName !== 'image' || attribute.localName !== 'href') {attributes.push(attribute); continue;}
        let value = encoded.get(attribute.value);
        if (!value) {value = await this.images.dataUri(attribute.value); encoded.set(attribute.value,value);}
        attributes.push({...attribute,value});
      }
      return tag(node,children.join(''),attributes);
    };
    let body = await serialize(el);
    for (const parent of [...ancestors].reverse()) if (parent !== this.root) body = tag(parent,body);
    let defs = '';
    for (const child of this.root.children) if (child.localName === 'defs') defs += await serialize(child);
    const box = (this.root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
    const style = await fontStyle();
    const result = await this.options.rasterize({svg:tag(this.root,defs + style + body),width:box[2],height:box[3],signal:this.options.signal});
    if (this.options.signal?.aborted) throw new DOMException('PDF 导出已取消','AbortError');
    this.issues.push(issue);
    if (!result) return '';
    // 栅格器在页面坐标中保留滤镜外扩；撤销 PDF 当前祖先矩阵，避免组变换被重复应用。
    const parentMatrix = ancestors.reduce((matrix,parent) => multiply(matrix,svgMatrix(parent.getAttribute('transform') ?? '')),identity);
    return `q ${inverse(parentMatrix).map(n).join(' ')} cm ${await this.images.drawBytes(result.bytes,result.x,result.y,result.width,result.height)} Q`;
  }
}
