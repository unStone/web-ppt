import { invalidMp4, mp4Box, mp4Boxes, mp4Tag, mp4Uint } from './mp4-boxes';
import { assertMp4Samples } from './mp4-samples';
import { assertMp4Fragments, type Mp4Track } from './mp4-fragments';

/** 上传仅验证容器闭包，不引入解码器；实际编解码能力仍由播放器决定。 */
export function assertMp4(bytes: Uint8Array): void {
  const boxes = mp4Boxes(bytes);
  const ftyp = mp4Box(boxes, 'ftyp');
  if (ftyp.end - ftyp.data < 8 || (ftyp.end - ftyp.data) % 4) invalidMp4();
  const brands = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso7', 'iso8', 'iso9',
    'mp41', 'mp42', 'avc1', 'dash', 'M4V ']);
  let accepted = brands.has(mp4Tag(bytes, ftyp.data));
  for (let at = ftyp.data + 8; at < ftyp.end; at += 4) accepted ||= brands.has(mp4Tag(bytes, at));
  if (!accepted) invalidMp4();
  const moov = mp4Box(boxes, 'moov');
  const mdats = boxes.filter((box) => box.type === 'mdat');
  if (!mdats.some((box) => box.end > box.data)) invalidMp4();
  const movie = mp4Boxes(bytes, moov.data, moov.end);
  const mvhd = mp4Box(movie, 'mvhd'), movieVersion = mp4Uint(bytes, mvhd, 0, 1);
  if (movieVersion > 1 || mvhd.end - mvhd.data < (movieVersion ? 112 : 100)
    || !mp4Uint(bytes, mvhd, movieVersion ? 20 : 12)) invalidMp4();
  const tracks = movie.filter((box) => box.type === 'trak');
  if (!tracks.length) invalidMp4();
  const trackInfo = new Map<number, Mp4Track>();
  for (const track of tracks) {
    const children = mp4Boxes(bytes, track.data, track.end), tkhd = mp4Box(children, 'tkhd');
    const version = mp4Uint(bytes, tkhd, 0, 1);
    const id = mp4Uint(bytes, tkhd, version === 1 ? 20 : 12);
    if (version > 1 || tkhd.end - tkhd.data < (version ? 96 : 84) || !id || trackInfo.has(id)) invalidMp4();
    const mdia = mp4Box(children, 'mdia');
    const contents = mp4Boxes(bytes, mdia.data, mdia.end);
    const mdhd = mp4Box(contents, 'mdhd'), mediaVersion = mp4Uint(bytes, mdhd, 0, 1);
    if (mediaVersion > 1 || mdhd.end - mdhd.data < (mediaVersion ? 36 : 24)
      || !mp4Uint(bytes, mdhd, mediaVersion ? 20 : 12)) invalidMp4();
    const hdlr = mp4Box(contents, 'hdlr');
    if (hdlr.end - hdlr.data < 12) invalidMp4();
    const video = mp4Tag(bytes, hdlr.data + 8) === 'vide';
    const minf = mp4Box(contents, 'minf');
    const dinf = mp4Box(mp4Boxes(bytes, minf.data, minf.end), 'dinf');
    const dref = mp4Box(mp4Boxes(bytes, dinf.data, dinf.end), 'dref');
    const count = mp4Uint(bytes, dref, 4);
    const references = mp4Boxes(bytes, dref.data + 8, dref.end);
    if (!count || count !== references.length || references.some((ref) =>
      ref.type !== 'url ' || mp4Uint(bytes, ref, 0) !== 1 || ref.end - ref.data !== 4)) invalidMp4();
    const stbl = mp4Box(mp4Boxes(bytes, minf.data, minf.end), 'stbl');
    const tables = mp4Boxes(bytes, stbl.data, stbl.end);
    const stsd = mp4Box(tables, 'stsd');
    const descriptions = mp4Boxes(bytes, stsd.data + 8, stsd.end);
    if (mp4Uint(bytes, stsd, 0) || !descriptions.length || descriptions.length !== mp4Uint(bytes, stsd, 4)) invalidMp4();
    for (const description of descriptions) {
      const reference = mp4Uint(bytes, description, 6, 2);
      if (!reference || reference > count || ['encv', 'enca'].includes(description.type)) invalidMp4();
      if (video && (description.end - description.data < 78 || !mp4Uint(bytes, description, 24, 2)
        || !mp4Uint(bytes, description, 26, 2))) invalidMp4();
    }
    trackInfo.set(id, { video, descriptions: descriptions.length,
      samples: assertMp4Samples(bytes, tables, mdats, descriptions.length) });
  }
  assertMp4Fragments(bytes, boxes, movie, trackInfo);
  if (![...trackInfo.values()].some((track) => track.video && track.samples > 0)) invalidMp4();
}
