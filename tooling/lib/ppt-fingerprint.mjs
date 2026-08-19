/**
 * 输出一份演示文稿「渲染结果」的指纹，供 make-ppt-samples 判断内容是否真的变了。
 *
 *   node tooling/lib/ppt-fingerprint.mjs <bundle.mjs> <file.ppt>
 *
 * 必须在独立进程里跑：渲染器的 defs id 来自一个跨解析累加的全局计数器
 * （同页多个 SVG 不能撞 id，这是有意设计），而 metafile 解码出的 SVG
 * 会把这些 id 封进 data URI，normalizeSvg 够不着。同进程里连算两份指纹
 * 只会得到两个不同的值 —— 每份都从干净进程算起才有可比性。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDomEnv } from './dom-env.mjs';
import { normalizeSvg } from './snapshot.mjs';

const [bundle, file] = process.argv.slice(2);
if (!bundle || !file) {
  console.error('用法: node ppt-fingerprint.mjs <bundle.mjs> <file>');
  process.exit(2);
}

installDomEnv();
const lib = await import(`file://${join(dirname(fileURLToPath(import.meta.url)), '..', '..', bundle)}`);

const pres = await lib.parse(new Uint8Array(readFileSync(file)));
const parts = [`pages=${pres.slides.length}`];
for (const s of pres.slides) {
  parts.push(`hidden=${!!s.hidden}`, `notes=${(s.notes ?? '').length}`);
  for (const mode of ['html', 'svg']) {
    parts.push(normalizeSvg(lib.renderSlideToSvg(pres, s, { textMode: mode })));
  }
}
process.stdout.write(createHash('sha256').update(parts.join('\n')).digest('hex'));
