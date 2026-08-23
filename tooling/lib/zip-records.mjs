const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const decoder = new TextDecoder();

export function findEocd(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lower = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= lower; offset--) {
    if (view.getUint32(offset, true) !== END_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === bytes.length) return offset;
  }
  throw new Error('测试 ZIP 缺少有效 EOCD');
}

/** 测试侧只按 APPNOTE 固定字段扫描，避免用生产解析器证明生产解析器正确。 */
export function scanCentralEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEocd(bytes);
  const total = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const entries = [];
  for (let index = 0; index < total; index++) {
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
      throw new Error(`测试 ZIP 中央目录第 ${index + 1} 项损坏`);
    }
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const localEnd = localOffset + 30 + localNameLength + localExtraLength + compressedSize;
    entries.push({
      name,
      cursor,
      localOffset,
      localEnd,
      nameLength,
      extraLength,
      commentLength,
      localNameLength,
      localExtraLength,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function localRecords(bytes) {
  const records = new Map();
  for (const entry of scanCentralEntries(bytes)) {
    records.set(entry.name, bytes.slice(entry.localOffset, entry.localEnd));
  }
  return records;
}
