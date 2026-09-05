import { makeMp4 } from './media-mp4-fixture.mjs';

const words = (...values) => {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => bytes.writeUInt32BE(value, index * 4));
  return bytes;
};
const box = (type, payload) => Buffer.concat([words(8 + payload.length), Buffer.from(type), payload]);

/** 多条 run 复用相同地址是字节级上限挡不住的计算量放大输入；不用于编解码验收。 */
export function makeRepeatedSampleMp4(runs = 2000, samples = 200000) {
  const source = Buffer.from(makeMp4(true));
  const prefix = source.subarray(0, source.indexOf('moof') - 4);
  const tfhd = box('tfhd', words(0x020018, 1, 1, 1));
  const fragment = (offset) => box('moof', Buffer.concat([
    box('mfhd', words(0, 1)),
    box('traf', Buffer.concat([tfhd, ...Array.from({ length: runs },
      () => box('trun', words(1, samples, offset)))])),
  ]));
  const moof = fragment(fragment(0).length + 8);
  return new Uint8Array(Buffer.concat([prefix, moof, box('mdat', Buffer.alloc(samples, 7))]));
}

/** 改时序而不改码流或总时长；原地替换避免移动任何 chunk 地址。 */
export function makeZeroDurationMp4(fragmented = false) {
  const bytes = makeMp4(fragmented), view = new DataView(bytes.buffer);
  if (fragmented) {
    const at = Buffer.from(bytes).indexOf('trun');
    const first = view.getUint32(at + 20), second = view.getUint32(at + 28);
    view.setUint32(at + 20, 0); view.setUint32(at + 28, first + second);
  } else {
    const at = Buffer.from(bytes).indexOf('stts') - 4;
    if (view.getUint32(at) !== 24 || view.getUint32(at + 24) !== 20
      || Buffer.from(bytes).toString('ascii', at + 28, at + 32) !== 'stss') throw new Error('零时长来源固件改变');
    for (const [offset, value] of [[0, 32], [12, 2], [16, 1], [20, 0], [24, 2], [28, 3072], [32, 12], [40, 0]]) {
      view.setUint32(at + offset, value);
    }
    bytes.set(Buffer.from('free'), at + 36);
  }
  return bytes;
}
