import { copyElements } from '@web-ppt/edit-core';
import { copiedLinkMeta } from '../clipboard-links';
import { effectiveElement, slideOfElement } from '../projection';
import { mergeSessionAssets } from '../session-assets';
import { materializeGeneratedParts } from './materialize';
import { initialFractionalIndex } from '../fractional-index';
import type { SlideElement } from '@web-ppt/core';
import type { EditDoc, ElementId, ElementRecord } from '../types';
import type { ElementClipboardPayload } from '../commands/types';

function snapshotRecords(source: EditDoc): Record<string, ElementRecord> {
  const records: Record<string, ElementRecord> = Object.fromEntries(Object.entries(source.elements).map(([id, record]) => {
    const { extensions: _extensions, ...ovr } = record.ovr;
    return [id, { ...record, ovr }];
  }));
  let sequence = 0;
  const add = (src: SlideElement, parent: string, index: number): string => {
    let id: string;
    do id = `clipboard-projection-${++sequence}`; while (records[id]);
    const children = src.kind === 'group' ? src.children.map((child, i) => add(child, id, i)) : undefined;
    records[id] = { id, parent, src, children, ovr: {}, z: initialFractionalIndex(index), meta: { editable: 'none' } };
    return id;
  };
  // 生成宿主不保存派生孩子；复制快照需要把有效画面展开成只读记录，不能退回旧模型树。
  for (const record of Object.values(records)) if (record.meta.editable === 'frame' && record.src.kind === 'group') {
    records[record.id] = { ...record, children: record.src.children.map((child, index) => add(child, record.id, index)) };
  }
  return records;
}

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
  const parts=materializeGeneratedParts(selected,(_,work)=>{generated=work;},doc);
  if(!generated)throw new Error('复制来源页面为空');
  // 生成资源已吸收全部扩展；临时复制模型从此快照读取，不能在新来源上再次应用结构覆盖。
  const elements=snapshotRecords(generated);
  const work: EditDoc={...generated,elements,extensions:{},package:{format:'pptx',parts,bytes:new Uint8Array(),disposed:false},saveState:{...generated.saveState,baselines:parts}};
  // 原始资源 URL 属于源会话；只把映射借给临时模型，载荷仍携带独立字节。
  mergeSessionAssets(work,doc);
  const payload=copyElements(work,ids);
  const linkedRecords={...payload.records};
  const visit=(id:string,copiedId:string)=>{
    const record=payload.records[copiedId];
    linkedRecords[copiedId]={...record,meta:{...record.meta,...copiedLinkMeta(doc,id,effectiveElement(doc,id))}};
    // 原生框架的绘制孩子没有独立模型身份，数量也会随数据变化；只回填可编辑的真实后代。
    if(doc.elements[id].meta.editable!=='frame')
      (doc.elements[id].children??[]).forEach((child,index)=>visit(child,record.children[index]));
  };
  const ordered=[...ids].sort((a,b)=>(doc.elements[a].order??doc.elements[a].z).localeCompare(doc.elements[b].order??doc.elements[b].z));
  ordered.forEach((id,index)=>visit(id,payload.roots[index]));
  return {...payload,records:linkedRecords};
}
