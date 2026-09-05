import { makeMp4 } from './media-mp4-fixture.mjs';

export function runMp4Boundaries({ editor, media, command, assert }) {
  const field = (bytes, tag, offset, value, size = 4) => {
    // ftyp 的兼容品牌也含 avc1；这些变体要改样本描述，不能误改文件头。
    const at = Buffer.from(bytes).indexOf(tag, 32);
    if (at < 0) throw new Error(`MP4 拒绝固件缺少 ${tag}`);
    const view = new DataView(bytes.buffer);
    if (size === 2) view.setUint16(at + offset, value);
    else view.setUint32(at + offset, value);
    return bytes;
  };
  const tag = (bytes, old, next) => {
    bytes.set(Buffer.from(next), Buffer.from(bytes).indexOf(old, 32)); return bytes;
  };
  const cases = [
    ['文件末尾截断', () => makeMp4().slice(0, -1)],
    ['伪造品牌', () => { const bytes = makeMp4(); bytes.fill(32, 8, 32); return bytes; }],
    ['64 位 box 长度溢出', () => { const bytes = makeMp4(); const view = new DataView(bytes.buffer);
      view.setUint32(0, 1); view.setUint32(8, 0xffffffff); return bytes; }],
    ['内层 box 越界', () => field(makeMp4(), 'stsc', -4, 0xffffffff)],
    ['轨道头缺少必填字段', () => {
      const bytes = makeMp4(), at = Buffer.from(bytes).indexOf('tkhd') - 4;
      const view = new DataView(bytes.buffer), size = view.getUint32(at);
      view.setUint32(at, 24); view.setUint32(at + 24, size - 24);
      bytes.set(Buffer.from('free'), at + 28); return bytes;
    }],
    ['错误的样本描述引用', () => field(makeMp4(), 'avc1', 10, 0, 2)],
    ['加密视频不能伪装离线内容', () => tag(makeMp4(), 'avc1', 'encv')],
    ['没有视频轨道', () => tag(makeMp4(), 'vide', 'soun')],
    ['时间表与样本数不一致', () => field(makeMp4(), 'stts', 12, 0)],
    ['紧凑样本表不能声明 32 位字段', () => {
      const bytes = tag(makeMp4(), 'stsz', 'stz2');
      bytes[Buffer.from(bytes).indexOf('stz2') + 11] = 32; return bytes;
    }],
    ['视频宽度为零', () => field(makeMp4(), 'avc1', 28, 0, 2)],
    ['分片引用不存在的轨道', () => field(makeMp4(true), 'tfhd', 8, 99)],
    ['分片条目数量溢出', () => field(makeMp4(true), 'trun', 8, 0xffffffff)],
    ['分片载荷大小谎报', () => field(makeMp4(true), 'trun', 24, 0xffffffff)],
  ];
  for (const [label, makeBytes] of cases) {
    const identity = structuredClone(editor.doc.identity), history = editor.history.undoCount;
    assert.throws(() => media.createMediaEditor(editor).exec(command(makeBytes())), /MP4/, label);
    assert.deepEqual(editor.doc.identity, identity, `${label} 不消耗身份`);
    assert.equal(editor.history.undoCount, history, `${label} 不污染历史`);
  }
}
