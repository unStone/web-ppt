import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as hb from 'harfbuzzjs';

export function verifyTemplateFillFonts(root, assert) {
  const base = join(root, 'tooling/template-fill-fonts');
  const manifest = JSON.parse(readFileSync(join(base, 'manifest.json'), 'utf8'));
  for (const item of manifest) {
    const bytes = readFileSync(join(base, item.name));
    assert.equal(bytes.length, item.bytes, `${item.name} 字节数必须与生成清单一致`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256, `${item.name} 字体来源不能漂移`);
  }
}

/** 测试调用方显式选择真实 OFL 字体；不把字数估算作为可交付字宽。 */
export function createTemplateFillMeasurement(root) {
  const open = (name) => {
    const face = new hb.Face(new hb.Blob(new Uint8Array(readFileSync(join(root, 'tooling/template-fill-fonts', name)))));
    return { face, font: new hb.Font(face) };
  };
  const regular = open('regular.ttf'), bold = open('bold.ttf');
  return (text, run, scale) => {
    if (!text) return 0;
    if (run.i) throw new Error('模板填充测试未提供真实斜体字体');
    const { face, font } = run.b ? bold : regular;
    const buffer = new hb.Buffer();
    buffer.addText(text); buffer.guessSegmentProperties();
    buffer.setDirection(hb.Direction.LTR); buffer.setScript('Latn'); buffer.setLanguage('en');
    hb.shape(font, buffer);
    const infos = buffer.getGlyphInfos(), positions = buffer.getGlyphPositions();
    if (infos.some(info => info.codepoint === 0)) throw new Error(`模板填充测试字体缺少字形：${text}`);
    if (infos.length !== positions.length) throw new Error('HarfBuzz 字形与位置数量不一致');
    const advance = positions.reduce((sum, glyph) => sum + glyph.xAdvance, 0) / face.upem;
    return advance * run.size * scale * (run.baseline ? .65 : 1) + (run.spacing ?? 0) * text.length;
  };
}
