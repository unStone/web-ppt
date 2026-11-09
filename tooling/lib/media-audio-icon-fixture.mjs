import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { makePng } from './ooxml.mjs';

/** 用 TypeScript 解析器读出 edit-core 内置的图标常量；按文本匹配会随源码排版失效。 */
export function readStoredAudioIcon(root) {
  const path = join(root, 'packages/edit-core/src/media/audio-icon.ts');
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest);
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const { name, initializer } of statement.declarationList.declarations) {
      if (ts.isIdentifier(name) && name.text === 'AUDIO_ICON_PNG' && initializer && ts.isStringLiteral(initializer))
        return initializer.text;
    }
  }
  throw new Error(`${path} 缺少字符串常量 AUDIO_ICON_PNG`);
}

/** 自制扬声器图标只用确定性几何，生成时抗锯齿，不把栅格器装进发布包。 */
export function makeAudioIcon() {
  return makePng(128, 128, (x, y) => {
    let coverage = 0;
    for (let sy = 0; sy < 4; sy++)
      for (let sx = 0; sx < 4; sx++) {
        const px = (x + (sx + 0.5) / 4) / 2,
          py = (y + (sy + 0.5) / 4) / 2;
        const dy = Math.abs(py - 32),
          radius = Math.hypot(px - 29, py - 32);
        const body = px >= 12 && px <= 23 && dy <= 7;
        const cone = px >= 23 && px <= 34 && dy <= 7 + ((px - 23) * 8) / 11;
        const wave = px > 37 && dy < px - 29 && ((radius >= 14 && radius <= 16) || (radius >= 23 && radius <= 25));
        if (body || cone || wave) coverage++;
      }
    return [37, 99, 235].map((channel) => Math.round(channel + ((255 - channel) * coverage) / 16));
  });
}
