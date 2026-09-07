import { copyElements } from '@web-ppt/edit-core';
import { copiedLinkMeta } from '../clipboard-links';
import { effectiveElement, slideOfElement } from '../projection';
import { mergeSessionAssets } from '../session-assets';
import { materializeGeneratedParts } from './materialize';
import type { EditDoc, ElementId, ElementRecord } from '../types';
import type { ElementClipboardPayload } from '../commands/types';

/** 直接从选中模型生成宿主片段；不生成 ZIP，不重新解析，也不修改源文档。 */
export function copyPortableElements(doc: EditDoc, ids: readonly ElementId[]): ElementClipboardPayload {
  if (doc.package && !doc.package.disposed && ids.every(id=>doc.elements[id]?.meta.origin)) return copyElements(doc,ids);
  if (!ids.length || new Set(ids).size!==ids.length) throw new Error('复制元素必须提供不重复的非空 id');
  const parent = doc.elements[ids[0]]?.parent, slideId = slideOfElement(doc,ids[0]);
  if (!parent || !slideId || ids.some(id=>doc.elements[id]?.parent!==parent)) throw new Error('复制的根元素必须属于同一父级');
  for (const id of ids) {
    const record = doc.elements[id];
    if (record.meta.editable==='none'||record.meta.locked) throw new Error(`元素不可复制或已锁定：${id}`);
  }
  const records: Record<string,ElementRecord> = Object.create(null);
  const include=(id: string)=>{ const source=doc.elements[id];records[id]={...source};for(const child of source.children??[])include(child); };
  for(const id of ids) include(id);
  let roots=[...ids], ancestor=parent;
  while(doc.elements[ancestor]) {
    records[ancestor]={...doc.elements[ancestor],children:roots};roots=[ancestor];ancestor=doc.elements[ancestor].parent;
  }
  const selected: EditDoc={...doc,elements:records,slides:{...doc.slides,[slideId]:{...doc.slides[slideId],children:roots,layoutId:undefined}},slideOrder:[slideId]};
  mergeSessionAssets(selected,doc);
  let generated: EditDoc | undefined;
  const parts=materializeGeneratedParts(selected,(_,work)=>{generated=work;});
  if(!generated)throw new Error('复制来源页面为空');
  const work: EditDoc={...generated,package:{format:'pptx',parts,bytes:new Uint8Array(),disposed:false},saveState:{...generated.saveState,baselines:parts}};
  // 原始资源 URL 属于源会话；只把映射借给临时模型，载荷仍携带独立字节。
  mergeSessionAssets(work,doc);
  const payload=copyElements(work,ids);
  const copied=Object.values(payload.records), originals:string[]=[];
  const visit=(id:string)=>{for(const child of doc.elements[id].children??[])visit(child);originals.push(id);};
  // copyElements 按页面层叠排序，树内按后序建立记录；依相同顺序回填跨页链接身份。
  const ordered=[...ids].sort((a,b)=>(doc.elements[a].order??doc.elements[a].z).localeCompare(doc.elements[b].order??doc.elements[b].z));
  for(const id of ordered)visit(id);
  return {...payload,records:Object.fromEntries(copied.map((record,i)=>[record.id,{...record,meta:{...record.meta,...copiedLinkMeta(doc,originals[i],effectiveElement(doc,originals[i]))}}]))};
}
