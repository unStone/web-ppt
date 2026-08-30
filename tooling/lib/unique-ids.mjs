/**
 * HTML 重复 id 检查。
 *
 * `querySelector('#x')` 只返回第一个匹配，曾因此让 drawArch() 把整个
 * `<section id="arch">` 连同 <h2> 与三条说明一起 innerHTML 覆盖掉——静态 HTML
 * 看着好好的，只有渲染后才暴露。
 *
 * 实现放在这里而不是 vite 插件里：构建期闸门只在 `npm run build:site` 时才拦，
 * 而 `npm run verify` 要能在不构建整站的前提下秒级给出同一结论。两处共用一份，
 * 避免规则悄悄分叉。
 */

/** 站点页面清单，vite 的构建入口与 id 校验都从这里取 */
export const SITE_PAGES = ['index.html', 'samples.html', 'editor.html'];

/** 返回 `#id×次数` 形式的重复项；没有重复时返回空数组 */
export function duplicateIds(html) {
  const seen = new Map();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) {
    seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
  }
  return [...seen].filter(([, n]) => n > 1).map(([id, n]) => `#${id}×${n}`);
}
