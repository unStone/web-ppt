import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';

/** 保留型 XML 树的公共契约；测试只观察 edit-core 导出，不依赖解析器内部结构。 */
export function runXmlTreeContract({ edit, check, eq, root }) {
  console.log('\n\x1b[36m▸ 保留型 XML 树\x1b[0m');
  const drawingNs = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const presentationNs = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  if (!check('公开保留型 XML 解析与序列化',
    typeof edit.parseXmlTree === 'function' && typeof edit.serializeXmlTree === 'function')) return;

  const source = '\uFEFF<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
    '<?generator keep="yes"?>\r\n' +
    '<!DOCTYPE p:sld [<!ENTITY sample "kept">]>\r\n' +
    '<!--before--><p:sld xmlns:p="urn:p" xmlns:a=\'urn:a\' mc:Ignorable="p14" xmlns:mc="urn:mc">' +
    '<mc:AlternateContent><mc:Choice Requires="p14"><a:xfrm x="1" /></mc:Choice>' +
    '<mc:Fallback><![CDATA[<opaque>&sample;</opaque>]]></mc:Fallback></mc:AlternateContent>' +
    '</p:sld><!--after-->\r\n';
  const tree = edit.parseXmlTree(source);
  eq('未修改 XML 逐字节回环', edit.serializeXmlTree(tree), source);

  if (!check('公开 XML 字节编码回环', typeof edit.serializeXmlTreeBytes === 'function')) return;
  const utf16Xml = '<?xml version="1.0" encoding="UTF-16"?><a:root x="1"><!--保留--></a:root>';
  const utf16Body = new Uint8Array(utf16Xml.length * 2);
  for (let index = 0; index < utf16Xml.length; index++) {
    const unit = utf16Xml.charCodeAt(index);
    utf16Body[index * 2] = unit & 0xff;
    utf16Body[index * 2 + 1] = unit >>> 8;
  }
  const utf16Bytes = new Uint8Array(utf16Body.length + 2);
  utf16Bytes.set([0xff, 0xfe]);
  utf16Bytes.set(utf16Body, 2);
  const utf16Tree = edit.parseXmlTree(utf16Bytes);
  eq('UTF-16LE 未修改字节完全相同',
    Buffer.from(edit.serializeXmlTreeBytes(utf16Tree)).toString('hex'), Buffer.from(utf16Bytes).toString('hex'));
  edit.setXmlAttribute(utf16Tree.root, 'x', '2');
  const changedUtf16 = edit.serializeXmlTreeBytes(utf16Tree);
  check('UTF-16LE 修改后保留 BOM 与编码', changedUtf16[0] === 0xff && changedUtf16[1] === 0xfe
    && new TextDecoder('utf-16le').decode(changedUtf16).includes('x="2"'));
  const declaredUtf16 = edit.serializeXmlTreeBytes(edit.parseXmlTree(
    '<?xml version="1.0" encoding="UTF-16"?><a:root>字</a:root>',
  ));
  check('string 输入按 XML 声明输出 UTF-16 字节', declaredUtf16[0] === 0xff && declaredUtf16[1] === 0xfe
    && new TextDecoder('utf-16le').decode(declaredUtf16).includes('<a:root>字</a:root>'));

  if (!check('公开前缀无关的 XML 查询',
    typeof edit.findXmlDescendant === 'function' && typeof edit.findXmlAttribute === 'function')) return;
  const alternate = edit.findXmlDescendant(tree.root, { localName: 'AlternateContent', namespaceUri: 'urn:mc' });
  const ignorable = edit.findXmlAttribute(tree.root, { localName: 'Ignorable', namespaceUri: 'urn:mc' });
  check('按 namespace URI 找到 AlternateContent', alternate?.name === 'mc:AlternateContent');
  eq('未知前缀属性仍保留限定名和值', `${ignorable?.name}:${ignorable?.value}`, 'mc:Ignorable:p14');

  const reboundTree = edit.parseXmlTree(
    '<old:root xmlns:old="urn:old"><old:child old:flag="1"/></old:root>',
  );
  const reboundChild = reboundTree.root.children.find((node) => node.type === 'element');
  edit.setXmlAttribute(reboundTree.root, 'xmlns:old', 'urn:new');
  check('修改 namespace 声明会重绑定元素和后代', reboundTree.root.namespaceUri === 'urn:new'
    && reboundChild?.namespaceUri === 'urn:new'
    && reboundChild.attributes[0]?.namespaceUri === 'urn:new');
  check('namespace 查询立即观察到声明变更',
    edit.findXmlDescendant(reboundTree.root, { localName: 'child', namespaceUri: 'urn:new' }) === reboundChild);
  edit.removeXmlAttribute(reboundTree.root, 'xmlns:old');
  check('删除 namespace 声明会清除未绑定前缀', reboundTree.root.namespaceUri === null
    && reboundChild?.namespaceUri === null && reboundChild.attributes[0]?.namespaceUri === null);
  const emptyDefaultTree = edit.parseXmlTree('<root xmlns="urn:outer"><child xmlns=""/></root>');
  check('空默认 namespace 统一表示为 null',
    edit.findXmlChild(emptyDefaultTree.root, { localName: 'child', namespaceUri: null })?.namespaceUri === null);

  edit.setXmlAttribute(tree.root, ignorable.name, 'p15');
  const dirtyOuter = edit.serializeXmlTree(tree);
  check('修改祖先时 AlternateContent 内部仍逐字保留', dirtyOuter.includes(
    '<mc:AlternateContent><mc:Choice Requires="p14"><a:xfrm x="1" /></mc:Choice>' +
    '<mc:Fallback><![CDATA[<opaque>&sample;</opaque>]]></mc:Fallback></mc:AlternateContent>',
  ));
  check('修改元素不会丢声明、PI、DOCTYPE 与外部注释', dirtyOuter.startsWith(
    '\uFEFF<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
    '<?generator keep="yes"?>\r\n<!DOCTYPE p:sld [<!ENTITY sample "kept">]>\r\n<!--before-->',
  ) && dirtyOuter.endsWith('<!--after-->\r\n'));

  if (!check('公开 XML 属性定点修改',
    typeof edit.setXmlAttribute === 'function' && typeof edit.removeXmlAttribute === 'function')) return;
  const attrSource = '<a:xfrm xmlns:a="urn:a"  y=\'2\' x = "1" data="&quot;&amp;" />';
  const attrTree = edit.parseXmlTree(attrSource);
  const xfrm = attrTree.root;
  eq('属性实体按 XML 语义解码', xfrm.attributes.find((attr) => attr.name === 'data')?.value, '"&');
  edit.setXmlAttribute(xfrm, 'x', '9525');
  edit.removeXmlAttribute(xfrm, 'y');
  edit.setXmlAttribute(xfrm, 'rot', '60000');
  eq('只改目标属性并保留其余词法形态', edit.serializeXmlTree(attrTree),
    '<a:xfrm xmlns:a="urn:a" x = "9525" data="&quot;&amp;" rot="60000" />');

  if (!check('公开 OOXML 有序插入',
    typeof edit.createXmlElement === 'function' && typeof edit.insertXmlInOrder === 'function')) return;
  const orderTree = edit.parseXmlTree(
    `<q:spPr xmlns:q="${drawingNs}"><q:prstGeom/><q:ln/><!--tail--></q:spPr>`,
  );
  const fill = edit.createXmlElement('q:solidFill');
  edit.insertXmlInOrder(orderTree.root, fill);
  eq('新节点按 schema sequence 插在几何与描边之间', edit.serializeXmlTree(orderTree),
    `<q:spPr xmlns:q="${drawingNs}"><q:prstGeom/><q:solidFill/><q:ln/><!--tail--></q:spPr>`);
  eq('新节点继承父级前缀的 namespace URI', fill.namespaceUri, drawingNs);
  const namespacedAttr = edit.setXmlAttribute(fill, 'q:marker', '1');
  eq('新属性使用挂载后的 namespace 上下文', namespacedAttr.namespaceUri, drawingNs);

  const prettyTree = edit.parseXmlTree(
    `<a:spPr xmlns:a="${drawingNs}">\r\n  <a:prstGeom/>\r\n  <a:ln/>\r\n</a:spPr>`,
  );
  edit.insertXmlInOrder(prettyTree.root, edit.createXmlElement('a:solidFill'));
  eq('有序插入继承原文件换行和缩进', edit.serializeXmlTree(prettyTree),
    `<a:spPr xmlns:a="${drawingNs}">\r\n  <a:prstGeom/>\r\n  <a:solidFill/>\r\n  <a:ln/>\r\n</a:spPr>`);

  const appendTree = edit.parseXmlTree(`<a:rPr xmlns:a="${drawingNs}">\n  <a:latin/>\n</a:rPr>`);
  edit.insertXmlInOrder(appendTree.root, edit.createXmlElement('a:cs'));
  eq('追加节点保持结束标签缩进', edit.serializeXmlTree(appendTree),
    `<a:rPr xmlns:a="${drawingNs}">\n  <a:latin/>\n  <a:cs/>\n</a:rPr>`);

  const orderCases = [
    ['ln', drawingNs, 'solidFill', 'tailEnd', 'prstDash'],
    ['pPr', drawingNs, 'spcAft', 'tabLst', 'buChar'],
    ['txBody', drawingNs, 'bodyPr', 'p', 'lstStyle'],
    ['sp', presentationNs, 'nvSpPr', 'txBody', 'spPr'],
    ['cSld', presentationNs, 'spTree', 'extLst', 'controls'],
    ['sld', presentationNs, 'cSld', 'timing', 'transition'],
  ];
  let allSequences = true;
  for (const [parentName, namespaceUri, beforeName, afterName, insertName] of orderCases) {
    const candidate = edit.parseXmlTree(
      `<a:${parentName} xmlns:a="${namespaceUri}"><a:${beforeName}/><a:${afterName}/></a:${parentName}>`,
    );
    edit.insertXmlInOrder(candidate.root, edit.createXmlElement(`a:${insertName}`));
    allSequences &&= edit.serializeXmlTree(candidate) ===
      `<a:${parentName} xmlns:a="${namespaceUri}"><a:${beforeName}/><a:${insertName}/>` +
      `<a:${afterName}/></a:${parentName}>`;
  }
  check('全部公开 OOXML sequence 容器按规范插入', allSequences);

  const compatibilityNs = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
  const wrappedTree = edit.parseXmlTree(
    `<a:spPr xmlns:a="${drawingNs}" xmlns:mc="${compatibilityNs}"><a:prstGeom/>` +
    '<mc:AlternateContent><mc:Choice Requires="a"><a:ln/></mc:Choice>' +
    '<mc:Fallback><a:ln/></mc:Fallback></mc:AlternateContent></a:spPr>',
  );
  edit.insertXmlInOrder(wrappedTree.root, edit.createXmlElement('a:solidFill'));
  check('有序插入会识别 AlternateContent 分支代表的序位', edit.serializeXmlTree(wrappedTree).includes(
    '<a:solidFill/><mc:AlternateContent>',
  ));

  const ambiguousTree = edit.parseXmlTree(
    `<a:spPr xmlns:a="${drawingNs}" xmlns:mc="${compatibilityNs}">` +
    '<mc:AlternateContent><mc:Choice Requires="a"><a:prstGeom/></mc:Choice>' +
    '<mc:Fallback><a:ln/></mc:Fallback></mc:AlternateContent></a:spPr>',
  );
  let rejectedAmbiguous = false;
  try { edit.insertXmlInOrder(ambiguousTree.root, edit.createXmlElement('a:solidFill')); } catch {
    rejectedAmbiguous = true;
  }
  check('AlternateContent 分支序位不一致时拒绝猜测', rejectedAmbiguous);

  const safeInsertTree = edit.parseXmlTree(
    `<a:spPr xmlns:a="${drawingNs}"><a:prstGeom/><a:ln/></a:spPr>`,
  );
  edit.insertXmlChild(safeInsertTree.root, edit.createXmlElement('a:solidFill'));
  eq('公开底层入口不能绕过 OOXML sequence', edit.serializeXmlTree(safeInsertTree),
    `<a:spPr xmlns:a="${drawingNs}"><a:prstGeom/><a:solidFill/><a:ln/></a:spPr>`);

  const emptyParent = edit.parseXmlTree(`<a:rPr xmlns:a="${drawingNs}"/>`);
  edit.insertXmlInOrder(emptyParent.root, edit.createXmlElement('a:latin', {
    attributes: [['typeface', 'A&B']],
  }));
  eq('自闭合父节点展开且新属性正确转义', edit.serializeXmlTree(emptyParent),
    `<a:rPr xmlns:a="${drawingNs}"><a:latin typeface="A&amp;B"/></a:rPr>`);

  const textTree = edit.parseXmlTree('<a:t xml:space="preserve"/>');
  edit.insertXmlChild(textTree.root, edit.createXmlText(' <&> '));
  eq('新增文本展开父节点并转义 XML 字符', edit.serializeXmlTree(textTree),
    '<a:t xml:space="preserve"> &lt;&amp;&gt; </a:t>');
  check('挂入子节点后父元素不再自闭合', textTree.root.selfClosing === false);

  const removeTree = edit.parseXmlTree(
    '<a:spPr>\n  <a:prstGeom/>\n  <a:solidFill/>\n  <a:ln/>\n</a:spPr>',
  );
  const removedFill = removeTree.root.children.find((node) =>
    node.type === 'element' && node.localName === 'solidFill');
  if (check('找到待删除 XML 子节点', !!removedFill)) edit.removeXmlChild(removeTree.root, removedFill);
  eq('删除节点同时收掉它独占的缩进空白', edit.serializeXmlTree(removeTree),
    '<a:spPr>\n  <a:prstGeom/>\n  <a:ln/>\n</a:spPr>');

  const reorderTree = edit.parseXmlTree(
    '<p:spTree>\n  <p:sp name="a"/>\n  <p:extLst/>\n  <p:sp name="b"/>\n</p:spTree>',
  );
  const reorderElements = reorderTree.root.children.filter((node) => node.type === 'element');
  const firstShape = reorderElements[0];
  const secondShape = reorderElements[2];
  const reordered = edit.reorderXmlChildren(reorderTree.root, [secondShape, firstShape]);
  eq('既有节点重排只替换目标槽位并保留扩展节点与缩进', edit.serializeXmlTree(reorderTree),
    '<p:spTree>\n  <p:sp name="b"/>\n  <p:extLst/>\n  <p:sp name="a"/>\n</p:spTree>');
  check('XML 重排报告真实变化且重复执行为无操作', reordered
    && edit.reorderXmlChildren(reorderTree.root, [secondShape, firstShape]) === false);

  let rejectedUnknown = false;
  try {
    edit.insertXmlInOrder(
      edit.parseXmlTree(`<a:spPr xmlns:a="${drawingNs}"/>`).root,
      edit.createXmlElement('a:unknown'),
    );
  } catch {
    rejectedUnknown = true;
  }
  check('已知容器拒绝未登记顺序的新节点', rejectedUnknown);

  const customTree = edit.parseXmlTree('<x:spPr xmlns:x="urn:custom"><x:first/></x:spPr>');
  let customAccepted = true;
  try { edit.insertXmlInOrder(customTree.root, edit.createXmlElement('x:unknown')); } catch { customAccepted = false; }
  check('自定义命名空间同名容器不套用 OOXML 顺序表', customAccepted);

  const overrideTree = edit.parseXmlTree('<x:root xmlns:x="urn:custom"/>');
  let rejectedNamespaceOverride = false;
  try {
    edit.insertXmlChild(overrideTree.root,
      edit.createXmlElement('x:child', { namespaceUri: drawingNs }));
  } catch {
    rejectedNamespaceOverride = true;
  }
  check('新节点不能用内存 namespace 覆盖 QName 的真实绑定', rejectedNamespaceOverride);

  let rejectedInvalidNames = 0;
  for (const operation of [
    () => edit.createXmlElement('a::broken'),
    () => edit.setXmlAttribute(edit.createXmlElement('a:ok'), 'a/b', '1'),
    () => edit.parseXmlTree('<a::broken/>'),
  ]) {
    try { operation(); } catch { rejectedInvalidNames++; }
  }
  eq('解析与创建入口统一拒绝非法 QName', rejectedInvalidNames, 3);

  const decoder = new TextDecoder();
  const fixtureNames = readdirSync(join(root, 'fixtures')).filter((name) => name.endsWith('.pptx')).sort();
  let xmlParts = 0;
  let exactParts = 0;
  let firstFailure = '';
  let realSlideXml = '';
  for (const fixture of fixtureNames) {
    const archive = new Uint8Array(readFileSync(join(root, 'fixtures', fixture)));
    // 加密 OOXML 外层是 CFB，解密能力已由 core 单测覆盖；本票只审计可直接读取的 XML part。
    if (archive[0] !== 0x50 || archive[1] !== 0x4b) continue;
    const parts = unzipSync(archive);
    for (const [part, bytes] of Object.entries(parts)) {
      if (!/\.(?:xml|rels|vml)$/i.test(part)) continue;
      xmlParts++;
      try {
        const xml = decoder.decode(bytes);
        if (fixture === 'showcase.pptx' && part === 'ppt/slides/slide1.xml') realSlideXml = xml;
        const output = edit.serializeXmlTreeBytes(edit.parseXmlTree(bytes));
        if (output.length === bytes.length && output.every((value, index) => value === bytes[index])) exactParts++;
        else if (!firstFailure) firstFailure = `${fixture}:${part} 非逐字相同`;
      } catch (error) {
        if (!firstFailure) firstFailure = `${fixture}:${part} ${error instanceof Error ? error.message : error}`;
      }
    }
  }
  check('真实固件包含大量 XML part', xmlParts > 300, `实际 ${xmlParts}`);
  check('全部真实 OOXML part 未修改逐字回环', exactParts === xmlParts,
    `${exactParts}/${xmlParts}${firstFailure ? `；首个失败 ${firstFailure}` : ''}`);
  console.log(`  ${fixtureNames.length} 份 pptx · ${xmlParts} 个 XML part 逐字回环`);

  if (check('找到真实幻灯片 XML', !!realSlideXml)) {
    const realTree = edit.parseXmlTree(realSlideXml);
    const realXfrm = edit.findXmlDescendant(realTree.root, { localName: 'xfrm' });
    const realOff = realXfrm && edit.findXmlChild(realXfrm, { localName: 'off' });
    const x = realOff && edit.findXmlAttribute(realOff, { localName: 'x', namespaceUri: null });
    if (check('找到真实 a:xfrm/a:off@x', !!realOff && !!x)) {
      const replacement = '987654321';
      const original = x.value;
      edit.setXmlAttribute(realOff, x.name, replacement);
      const changed = edit.serializeXmlTree(realTree);
      let prefix = 0;
      while (realSlideXml[prefix] === changed[prefix]) prefix++;
      let sourceEnd = realSlideXml.length;
      let changedEnd = changed.length;
      while (sourceEnd > prefix && changedEnd > prefix
        && realSlideXml[sourceEnd - 1] === changed[changedEnd - 1]) {
        sourceEnd--;
        changedEnd--;
      }
      eq('真实 part 定点修改只删除原属性值', realSlideXml.slice(prefix, sourceEnd), original);
      eq('真实 part 定点修改只插入新属性值', changed.slice(prefix, changedEnd), replacement);
    }
  }

  const savedDocument = globalThis.document;
  globalThis.document = undefined;
  try {
    const workerTree = edit.parseXmlTree('<a:root><a:child/></a:root>');
    check('保留型 XML 树可在 Worker 无 DOM 环境运行', edit.serializeXmlTree(workerTree).includes('a:child'));
  } finally {
    globalThis.document = savedDocument;
  }

  const malformed = [
    '<a><b></a>',
    '<a x=1/>',
    '<a><!--not closed</a>',
    'not-xml<a/>',
    '<a/><b/>',
    '<a x="1" x="2"/>',
  ];
  let rejected = 0;
  for (const xml of malformed) {
    try { edit.parseXmlTree(xml); } catch { rejected++; }
  }
  eq('损坏 XML 全部明确拒绝', rejected, malformed.length);

  let seed = 0x584d4c;
  let attributeProperty = true;
  for (let round = 0; round < 100; round++) {
    const propertyTree = edit.parseXmlTree('<a:e a0="0" a1="1" a2="2"/>');
    const expected = new Map([['a0', '0'], ['a1', '1'], ['a2', '2']]);
    for (let operation = 0; operation < 50; operation++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const name = `a${seed % 10}`;
      if (seed & 8) {
        const value = `${seed}&"`;
        edit.setXmlAttribute(propertyTree.root, name, value);
        expected.set(name, value);
      } else {
        edit.removeXmlAttribute(propertyTree.root, name);
        expected.delete(name);
      }
    }
    const serialized = edit.serializeXmlTree(propertyTree);
    attributeProperty &&= edit.serializeXmlTree(propertyTree) === serialized;
    const reparsed = edit.parseXmlTree(serialized);
    attributeProperty &&= reparsed.root.attributes.length === expected.size
      && reparsed.root.attributes.every((attribute) => expected.get(attribute.name) === attribute.value);
  }
  check('五千次属性增删改保持确定且可重新解析', attributeProperty);
}
