import { unzipSync } from 'fflate';

export async function testHierarchyCollaboration({core, edit, chart, collab, input, assert}) {
  const peers=await Promise.all(['a','b'].map(async id=>{
    const p=await core.parse(input,{edit:true,keepPackage:true,lazy:false});
    const editor=new edit.Editor(edit.createDoc(p,{idPrefix:'hierarchy-collab-'}),{origin:id});
    return {p,editor,id,api:chart.createChartDataEditor(editor)};
  }));
  const listeners=new Map(),queue=[],errors=[];
  const bindings=peers.map((peer,index)=>collab.bindCollaboration(peer.editor,{
    documentId:'hierarchy',replicaId:peer.id,replicaSlot:index+1,
    provider:{send:message=>{for(const id of listeners.keys())if(id!==peer.id)queue.push([id,structuredClone(message)]);},
      subscribe:listener=>{listeners.set(peer.id,listener);return()=>listeners.delete(peer.id);}},
    onError:error=>errors.push(error),
  }));
  const flush=()=>{for(const [id,message] of queue.splice(0).reverse()){listeners.get(id)(message);listeners.get(id)(structuredClone(message));}};
  const [a,b]=peers,id=chart.listEditableCharts(a.editor.doc)[1].id;
  const query=peer=>chart.queryChartData(peer.editor.doc,id),initial=query(a),point=initial.categories[0].id;
  a.api.setCategoryLevel(id,point,0,'West');b.api.setCategoryLevel(id,point,1,'Central');flush();
  assert.deepEqual(query(a).categories[0].levels,['West','Central','A'],'不同级别并发保留双方字段');
  assert.deepEqual(query(a),query(b),'重复、反序网络消息仍收敛');
  a.api.setCategoryLevel(id,point,0,'A group');b.api.setCategoryLevel(id,point,0,'B group');flush();
  assert.equal(query(a).categories[0].levels[0],'B group','同一层级 LWW 仲裁');
  a.api.removeCategory(id,initial.categories[0].id);b.api.removeCategory(id,initial.categories[1].id);flush();
  assert.deepEqual(query(a).categories[0].levels,['B group','West',''],'相邻组首并发删除仍继承剩余原生跨度');
  assert.deepEqual(query(a),query(b));
  const created=a.api.addCategory(id,['Fresh','Middle','Leaf']);
  a.api.setCategoryLevel(id,created,1,'Edited before delivery');flush();
  assert.deepEqual(query(b).categories.at(-1).levels,['Fresh','Edited before delivery','Leaf'],'新增记录和后续改单级反序到达');
  assert.deepEqual(query(a),query(b));
  const saved=await Promise.all(peers.map(peer=>peer.editor.save())),parts=saved.map(unzipSync);
  for(const part of ['ppt/charts/chart2.xml','ppt/embeddings/hierarchy2.xlsx'])assert.deepEqual(parts[0][part],parts[1][part],`协同保存 ${part} 收敛`);
  assert.deepEqual(errors,[]);
  bindings.forEach(binding=>binding.dispose());peers.forEach(peer=>{peer.editor.dispose();peer.p.dispose();});
}
