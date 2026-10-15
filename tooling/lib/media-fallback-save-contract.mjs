import { unzipSync, strFromU8 } from 'fflate';

/**
 * 经典引用为 NULL 等不可用状态、真实字节只在 p14:media 时（issue #7），两条保存路径都不能丢媒体：
 * 补丁路径原样保留宿主关系；原包释放后的生成路径必须把回退得到的字节写进经典与 p14 两条关系。
 */
export async function runMediaFallbackSaveContract({ core, edit, assert, fallback }) {
  for (const generated of [false, true]) {
    const label = generated ? '生成保存' : '补丁保存';
    const presentation = await core.parse(fallback, { edit: true, keepPackage: true, lazy: false });
    const wav = presentation.package.parts['ppt/media/media1.wav'];
    const mp4 = presentation.package.parts['ppt/media/media2.mp4'];
    const doc = edit.createDoc(presentation, { idPrefix: 'media-fallback-' });
    const editor = new edit.Editor(doc);
    let reopened;
    try {
      const id = Object.keys(doc.elements).find((key) => doc.elements[key].src.media?.spid === 10);
      assert.ok(id, `${label}：找到 NULL 经典引用的音频`);
      // 改动同页才会重写页面 part，否则补丁路径根本不碰媒体关系
      editor.exec({ type: 'SetXfrm', id, x: doc.elements[id].src.x + 4 });
      if (generated) presentation.dispose();
      const saved = await editor.save();
      const parts = unzipSync(saved);
      const slide = strFromU8(parts['ppt/slides/slide1.xml']);
      const rels = strFromU8(parts['ppt/slides/_rels/slide1.xml.rels']);
      if (generated) {
        assert.ok(slide.includes('<a:audioFile r:link="rIdMedia10"/>')
          && slide.includes('<p14:media r:embed="rIdMediaCompat10"/>'), `${label}：经典与 p14 引用都写回`);
        const target = (rid) => new RegExp(`Id="${rid}"[^>]*Target="\\.\\./media/([^"]+)"`).exec(rels)?.[1];
        assert.equal(target('rIdMedia10'), target('rIdMediaCompat10'), `${label}：两条关系指向同一部件`);
        assert.deepEqual(parts[`ppt/media/${target('rIdMedia10')}`], wav, `${label}：回退字节写入新部件`);
        assert.ok(!rels.includes('Target="NULL"'), `${label}：不再生成 NULL 经典关系`);
      } else {
        assert.ok(/Id="rIdNullAudio"[^>]*Target="NULL" TargetMode="External"/.test(rels), `${label}：原 NULL 关系原样保留`);
        assert.ok(slide.includes('r:embed="rIdWav"><p14:trim st="100"/>'), `${label}：p14:media 与 trim 原样保留`);
      }
      reopened = await core.parse(saved, { keepPackage: true, lazy: false });
      const bySpid = new Map(reopened.slides[0].elements.filter((el) => el.media).map((el) => [el.media.spid, el.media]));
      const bytes = (spid) => reopened.package.assets[bySpid.get(spid)?.src]?.bytes;
      for (const spid of [10, 13]) assert.deepEqual(bytes(spid), wav, `${label}：重开后 ${spid} 仍是内嵌 WAV`);
      for (const spid of [11, 12, 16]) assert.deepEqual(bytes(spid), mp4, `${label}：重开后 ${spid} 仍是内嵌 MP4`);
      assert.deepEqual([14, 15].map((spid) => [bySpid.get(spid).src, bySpid.get(spid).external]), [
        ['https://example.com/media/promo.mp4', true], ['https://example.com/media/voice.mp3', true],
      ], `${label}：外链保持外链`);
      assert.equal(bySpid.get(17).src, null, `${label}：两路都不可用的媒体仍为空源`);
    } finally {
      reopened?.dispose();
      editor.dispose();
      edit.disposeDoc(doc);
      if (!generated) presentation.dispose();
    }
  }
}
