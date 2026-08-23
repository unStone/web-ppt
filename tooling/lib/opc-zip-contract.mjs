import { unzipSync } from 'fflate';
import { equalBytes } from './bytes.mjs';
import { findEocd, localRecords, scanCentralEntries } from './zip-records.mjs';

const decoder = new TextDecoder();

function entryMetadataBytes(bytes, wanted) {
  for (const entry of scanCentralEntries(bytes)) {
    if (entry.name === wanted) {
      return {
        localExtra: bytes.slice(entry.localOffset + 30 + entry.localNameLength,
          entry.localOffset + 30 + entry.localNameLength + entry.localExtraLength),
        centralExtra: bytes.slice(entry.cursor + 46 + entry.nameLength,
          entry.cursor + 46 + entry.nameLength + entry.extraLength),
        comment: bytes.slice(entry.cursor + 46 + entry.nameLength + entry.extraLength,
          entry.cursor + 46 + entry.nameLength + entry.extraLength + entry.commentLength),
      };
    }
  }
  return null;
}

function withArchiveComment(bytes) {
  const end = findEocd(bytes);
  const comment = new TextEncoder().encode('archive-comment');
  const output = new Uint8Array(bytes.length + comment.length);
  output.set(bytes);
  output.set(comment, bytes.length);
  new DataView(output.buffer).setUint16(end + 20, comment.length, true);
  return output;
}

function withZip64Locator(bytes) {
  const end = findEocd(bytes);
  const output = new Uint8Array(bytes.length + 20);
  output.set(bytes.subarray(0, end));
  new DataView(output.buffer).setUint32(end, 0x07064b50, true);
  output.set(bytes.subarray(end), end + 20);
  return output;
}

function mutateZip(bytes, mutation) {
  const output = bytes.slice();
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const end = findEocd(output);
  const first = scanCentralEntries(output)[0];
  const central = first.cursor;
  const local = first.localOffset;
  mutation({ view, end, central, local });
  return output;
}

/** OPC 补丁保存的公共契约；预期值来自 ZIP 字节规范与独立解压结果，不读取实现内部状态。 */
export async function runOpcZipContract({ opc, core, load, check, eq }) {
  console.log('\n\x1b[36m▸ OPC ZIP 直通保存\x1b[0m');
  if (!check('公开纯字节 OPC 补丁入口', typeof opc.patchOpcPackage === 'function')) return;
  check('公开独立保存包释放入口', typeof opc.disposeOpcPackage === 'function');

  const bytes = load('showcase.pptx');
  if (!check('找到 OPC 保存固件', !!bytes)) return;
  const pres = await core.parse(bytes, { keepPackage: true, lazy: false, assets: 'defer' });
  const source = pres.package;
  if (!check('保存固件暴露原包', !!source)) return;

  const untouched = opc.patchOpcPackage(source, {});
  eq('无编辑保存进入 identity 模式', untouched.mode, 'identity');
  eq('无编辑保存复用原始字节视图', untouched.bytes, source.bytes);
  eq('无编辑保存复用原包句柄', untouched.package, source);

  const target = 'ppt/slides/slide1.xml';
  const replacement = new TextEncoder().encode(`${decoder.decode(source.parts[target])}<!--opc-patch-->`);
  const patched = opc.patchOpcPackage(source, { [target]: replacement });
  const deterministic = opc.patchOpcPackage(source, { [target]: replacement });
  eq('修改单个 part 使用直通模式', patched.mode, 'passthrough');
  check('相同输入与修改产生确定性 ZIP 字节', equalBytes(deterministic.bytes, patched.bytes));
  check('直通保存产生新的包字节和句柄', patched.bytes !== source.bytes && patched.package !== source);
  const outputParts = unzipSync(patched.bytes);
  check('脏 part 解压后等于调用方提供的字节', equalBytes(outputParts[target], replacement));
  check('全部净 part 解压内容保持相同', Object.entries(source.parts).every(([name, part]) =>
    name === target || equalBytes(outputParts[name], part)));

  const beforeRecords = localRecords(source.bytes);
  const afterRecords = localRecords(patched.bytes);
  check('全部净条目的本地头、extra 与压缩流逐字节直通', [...beforeRecords].every(([name, record]) =>
    name === target || equalBytes(afterRecords.get(name), record)));
  check('目标条目确实重新写入', !equalBytes(afterRecords.get(target), beforeRecords.get(target)));
  eq('直通统计只重写一个条目', patched.rewrittenEntries, 1);
  eq('直通统计保留其余条目', patched.preservedEntries, beforeRecords.size - 1);
  eq('修改 part 不改变原中央目录顺序', JSON.stringify([...afterRecords.keys()]),
    JSON.stringify([...beforeRecords.keys()]));

  const reparsed = await core.parse(patched.bytes, {
    keepPackage: true, lazy: false, assets: 'defer',
  });
  eq('直通产物可由公开解析器重新打开', reparsed.slides.length, pres.slides.length);
  check('重新解析后的统一投影逐字段相同', JSON.stringify(reparsed.slides) === JSON.stringify(pres.slides));
  check('重新解析后的两条文本渲染路径逐页相同', pres.slides.every((slide, index) =>
    ['html', 'svg'].every((textMode) => core.renderSlideToSvg(pres, slide, {
      textMode, idPrefix: `opc-${index}-`,
    }) === core.renderSlideToSvg(reparsed, reparsed.slides[index], {
      textMode, idPrefix: `opc-${index}-`,
    }))));
  const sameAgain = opc.patchOpcPackage(patched.package, { [target]: replacement });
  eq('相同修改第二次保存退化为 identity', sameAgain.mode, 'identity');
  eq('相同修改第二次保存不再复制字节', sameAgain.bytes, patched.bytes);

  const nextTarget = 'ppt/slides/slide2.xml';
  const nextReplacement = new TextEncoder().encode(
    `${decoder.decode(patched.package.parts[nextTarget])}<!--second-patch-->`,
  );
  const second = opc.patchOpcPackage(patched.package, { [nextTarget]: nextReplacement });
  const secondParts = unzipSync(second.bytes);
  const secondRecords = localRecords(second.bytes);
  eq('刷新包后修改另一 part 仍使用直通模式', second.mode, 'passthrough');
  check('连续保存保留上次脏 part 的新内容与压缩区间', equalBytes(secondParts[target], replacement)
    && equalBytes(secondRecords.get(target), afterRecords.get(target)));
  check('连续保存只改写第二个目标 part', equalBytes(secondParts[nextTarget], nextReplacement)
    && second.rewrittenEntries === 1);

  const mutableInput = new TextEncoder().encode(
    `${decoder.decode(source.parts[nextTarget])}<!--mutable-input-->`,
  );
  const snapshotted = opc.patchOpcPackage(source, { [nextTarget]: mutableInput });
  const expectedSnapshot = snapshotted.package.parts[nextTarget].slice();
  check('刷新后的包句柄仍可 structuredClone', structuredClone(snapshotted.package).disposed === false);
  mutableInput.fill(0);
  check('保存对脏缓冲拍快照，调用方后续修改不会破坏包与 ZIP 一致性',
    equalBytes(snapshotted.package.parts[nextTarget], expectedSnapshot)
    && equalBytes(unzipSync(snapshotted.bytes)[nextTarget], expectedSnapshot)
    && opc.patchOpcPackage(snapshotted.package, { [nextTarget]: expectedSnapshot }).mode === 'identity');
  reparsed.dispose?.();

  const deletedPart = 'ppt/notesSlides/notesSlide7.xml';
  const addedPart = 'customXml/web-ppt.bin';
  const addedBytes = new Uint8Array([0, 1, 2, 3, 0xfe, 0xff]);
  const structural = opc.patchOpcPackage(source, { [deletedPart]: null, [addedPart]: addedBytes });
  const structuralParts = unzipSync(structural.bytes);
  check('补丁保存可删除 OPC part', !(deletedPart in structuralParts)
    && !(deletedPart in structural.package.parts));
  check('补丁保存可新增二进制 OPC part', equalBytes(structuralParts[addedPart], addedBytes)
    && equalBytes(structural.package.parts[addedPart], addedBytes));
  const structuralOrder = [...localRecords(structural.bytes).keys()];
  const expectedStructuralOrder = [...beforeRecords.keys()].filter((name) => name !== deletedPart);
  expectedStructuralOrder.push(addedPart);
  eq('删除保持原顺序且新增 part 稳定追加', JSON.stringify(structuralOrder),
    JSON.stringify(expectedStructuralOrder));
  eq('新增与删除各计为一个重写条目', structural.rewrittenEntries, 2);

  const commentedBytes = withArchiveComment(source.bytes);
  const commentedPackage = Object.freeze({
    format: 'pptx', bytes: commentedBytes, parts: source.parts, disposed: false,
  });
  const commented = opc.patchOpcPackage(commentedPackage, { [target]: replacement });
  eq('存档注释触发可解释的整包重压', commented.mode, 'repacked');
  eq('存档注释降级原因可供 UI 展示', commented.fallbackReason, 'archive-comment');
  const commentedParts = unzipSync(commented.bytes);
  check('整包重压仍保持每个 part 的解压内容', Object.entries(source.parts).every(([name, part]) =>
    equalBytes(commentedParts[name], name === target ? replacement : part)));
  const unsupportedIdentity = opc.patchOpcPackage(commentedPackage, {});
  eq('不支持特性的包在无修改时仍保持整包身份', unsupportedIdentity.bytes, commentedBytes);

  const unsupportedCases = [
    ['data-descriptor', mutateZip(source.bytes, ({ view, central, local }) => {
      view.setUint16(central + 8, view.getUint16(central + 8, true) | 8, true);
      view.setUint16(local + 6, view.getUint16(local + 6, true) | 8, true);
    })],
    ['data-descriptor', mutateZip(source.bytes, ({ view, local }) => {
      view.setUint16(local + 6, view.getUint16(local + 6, true) | 8, true);
    })],
    ['encrypted-entry', mutateZip(source.bytes, ({ view, central, local }) => {
      view.setUint16(central + 8, view.getUint16(central + 8, true) | 1, true);
      view.setUint16(local + 6, view.getUint16(local + 6, true) | 1, true);
    })],
    ['unsupported-compression', mutateZip(source.bytes, ({ view, central, local }) => {
      view.setUint16(central + 10, 99, true);
      view.setUint16(local + 8, 99, true);
    })],
    ['zip64', mutateZip(source.bytes, ({ view, end }) => {
      view.setUint16(end + 8, 0xffff, true);
      view.setUint16(end + 10, 0xffff, true);
    })],
    ['zip64', mutateZip(source.bytes, ({ view, central }) => {
      view.setUint32(central + 20, 0xffffffff, true);
    })],
    ['zip64', withZip64Locator(source.bytes)],
    ['multi-disk', mutateZip(source.bytes, ({ view, end }) => view.setUint16(end + 4, 1, true))],
  ];
  let explainedFallbacks = true;
  for (const [reason, unsupportedBytes] of unsupportedCases) {
    const unsupportedPackage = Object.freeze({
      format: 'pptx', bytes: unsupportedBytes, parts: source.parts, disposed: false,
    });
    const result = opc.patchOpcPackage(unsupportedPackage, { [target]: replacement });
    const parts = unzipSync(result.bytes);
    explainedFallbacks &&= result.mode === 'repacked' && result.fallbackReason === reason
      && Object.entries(source.parts).every(([name, part]) =>
        equalBytes(parts[name], name === target ? replacement : part));
  }
  check('zip64、数据描述符、加密、未知压缩与多磁盘均可解释降级', explainedFallbacks);

  let rejectedBrokenZip = false;
  try {
    opc.patchOpcPackage(
      Object.freeze({ format: 'pptx', bytes: new Uint8Array([1, 2, 3]), parts: source.parts, disposed: false }),
      { [target]: replacement },
    );
  } catch {
    rejectedBrokenZip = true;
  }
  check('损坏 ZIP 明确拒绝而不伪装成功保存', rejectedBrokenZip);

  let rejectedInvalidPaths = 0;
  for (const name of ['/absolute.xml', '../escape.xml', 'a//b.xml', 'a\\b.xml']) {
    try { opc.patchOpcPackage(source, { [name]: new Uint8Array() }); } catch { rejectedInvalidPaths++; }
  }
  eq('新增和修改统一拒绝非法 OPC part 路径', rejectedInvalidPaths, 4);
  let rejectedDisposed = false;
  try {
    opc.patchOpcPackage(Object.freeze({ format: 'pptx', bytes: source.bytes, parts: source.parts, disposed: true }), {});
  } catch {
    rejectedDisposed = true;
  }
  check('已释放原包明确拒绝保存', rejectedDisposed);

  const savedDocument = globalThis.document;
  globalThis.document = undefined;
  try {
    check('ZIP 补丁器可在 Worker 无 DOM 环境运行',
      opc.patchOpcPackage(source, { [target]: replacement }).mode === 'passthrough');
  } finally {
    globalThis.document = savedDocument;
  }

  const featureBytes = load('sample-zip-passthrough.pptx');
  if (check('找到带 ZIP extra/comment 的确定性固件', !!featureBytes)) {
    const featurePres = await core.parse(featureBytes, { keepPackage: true, lazy: false });
    const featurePackage = featurePres.package;
    const featureTarget = '[Content_Types].xml';
    const featureClean = '_rels/.rels';
    if (check('特性固件暴露 OPC 原包', !!featurePackage)) {
      const featureBefore = entryMetadataBytes(featureBytes, featureTarget);
      const cleanBefore = entryMetadataBytes(featureBytes, featureClean);
      const cleanRecordBefore = localRecords(featureBytes).get(featureClean);
      check('特性固件确实包含本地/中央 extra 与条目注释', featureBefore?.localExtra.length > 0
        && featureBefore.centralExtra.length > 0 && featureBefore.comment.length > 0
        && cleanBefore?.localExtra.length > 0 && cleanBefore.centralExtra.length > 0
        && cleanBefore.comment.length > 0);
      const changed = new TextEncoder().encode(
        `${decoder.decode(featurePackage.parts[featureTarget])}<!--feature-patch-->`,
      );
      const featurePatched = opc.patchOpcPackage(featurePackage, { [featureTarget]: changed });
      const featureAfter = entryMetadataBytes(featurePatched.bytes, featureTarget);
      const cleanAfter = entryMetadataBytes(featurePatched.bytes, featureClean);
      check('重写脏条目仍逐字保留 local extra', equalBytes(featureAfter?.localExtra, featureBefore?.localExtra));
      check('重写脏条目仍逐字保留 central extra', equalBytes(featureAfter?.centralExtra, featureBefore?.centralExtra));
      check('重写脏条目仍逐字保留 entry comment', equalBytes(featureAfter?.comment, featureBefore?.comment));
      check('带 extra/comment 的净条目仍整段直通',
        equalBytes(localRecords(featurePatched.bytes).get(featureClean), cleanRecordBefore)
        && equalBytes(cleanAfter?.localExtra, cleanBefore?.localExtra)
        && equalBytes(cleanAfter?.centralExtra, cleanBefore?.centralExtra)
        && equalBytes(cleanAfter?.comment, cleanBefore?.comment));

      const zip64ExtraBytes = mutateZip(featureBytes, ({ view, central, local }) => {
        const centralNameLength = view.getUint16(central + 28, true);
        const localNameLength = view.getUint16(local + 26, true);
        view.setUint16(central + 46 + centralNameLength, 0x0001, true);
        view.setUint16(local + 30 + localNameLength, 0x0001, true);
      });
      const zip64ExtraPackage = Object.freeze({
        format: 'pptx', bytes: zip64ExtraBytes, parts: featurePackage.parts, disposed: false,
      });
      const zip64Extra = opc.patchOpcPackage(zip64ExtraPackage, { [featureTarget]: changed });
      eq('冗余 ZIP64 extra 也触发可解释重压', zip64Extra.fallbackReason, 'zip64');
    }
    featurePres.dispose?.();
  }

  let seed = 0x5a4950;
  let patchProperty = true;
  const sourceNames = Object.keys(source.parts);
  for (let round = 0; round < 50; round++) {
    const changes = {};
    const expected = new Map(Object.entries(source.parts));
    for (let operation = 0; operation < 5; operation++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const name = sourceNames[seed % sourceNames.length];
      if (seed & 4) {
        const current = source.parts[name];
        const changed = new Uint8Array(current.length + 2);
        changed.set(current);
        changed.set([seed & 0xff, seed >>> 8 & 0xff], current.length);
        changes[name] = changed;
        expected.set(name, changed);
      } else {
        changes[name] = null;
        expected.delete(name);
      }
    }
    const addedName = `customXml/property-${round}.bin`;
    const added = new Uint8Array([seed & 0xff, seed >>> 8 & 0xff]);
    changes[addedName] = added;
    expected.set(addedName, added);
    const result = opc.patchOpcPackage(source, changes);
    const output = unzipSync(result.bytes);
    patchProperty &&= Object.keys(output).length === expected.size
      && Object.entries(output).every(([name, part]) => equalBytes(part, expected.get(name)))
      && opc.patchOpcPackage(result.package, changes).mode === 'identity';
  }
  check('固定种子 part 增删改始终可重解压且重复保存幂等', patchProperty);
  const disposable = opc.patchOpcPackage(source, { [target]: replacement }).package;
  opc.disposeOpcPackage(disposable);
  check('独立保存结果可显式释放大包字节', disposable.disposed
    && disposable.bytes.length === 0 && Object.keys(disposable.parts).length === 0);
  pres.dispose?.();
}
