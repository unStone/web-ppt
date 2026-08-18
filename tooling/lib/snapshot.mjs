/**
 * SVG 快照：把渲染结果归一化后与基线逐字节比对。
 *
 * 结构断言抓不到视觉语义的回退（例如把 fill-rule 从 nonzero 改回 evenodd，
 * SVG 依然合法但图形被挖空），快照能。
 *
 * 归一化处理三类非确定内容：
 *   1. blob: URL —— 每次运行序号不同
 *   2. data URI —— 图元文件解码结果体积巨大，替换成内容摘要
 *   3. defs id —— 全局自增计数器，受渲染顺序影响
 */
import { createHash } from 'node:crypto';

const digest = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);

export function normalizeSvg(svg) {
  let out = svg;

  // data URI 只保留摘要，既能发现内容变化又不撑爆仓库。
  // 注意 encodeURIComponent 不转义 ( ) ' 等字符，字符类写窄了会提前截断，
  // 只能一路吃到闭合引号为止。
  out = out.replace(/data:[a-z/+.\-]+[;,][^"]*/gi, (m) => `data:<${digest(m)}>`);
  out = out.replace(/blob:[^"')\s]+/g, 'blob:<runtime>');

  // id 按出现顺序重编号，消除全局计数器带来的漂移
  const map = new Map();
  out = out.replace(/\sid="([^"]+)"/g, (_m, id) => {
    if (!map.has(id)) map.set(id, `s${map.size + 1}`);
    return ` id="${map.get(id)}"`;
  });
  out = out.replace(/url\(#([^)]+)\)/g, (m, id) => (map.has(id) ? `url(#${map.get(id)})` : m));
  // href="#id" / xlink:href="#id"（倒影用 <use> 引用本体）同样要跟着重编号，
  // 否则任一 fixture 元素数变化都会让无关文件的快照虚假漂移。
  out = out.replace(/((?:xlink:)?href)="#([^"]+)"/g,
    (m, attr, id) => (map.has(id) ? `${attr}="#${map.get(id)}"` : m));

  // 每个标签一行，diff 才有可读性
  return out.replace(/></g, '>\n<');
}

export const snapshotName = (file, page, mode) =>
  `${file.replace(/\./g, '_')}-p${String(page).padStart(2, '0')}-${mode}.svg`;
