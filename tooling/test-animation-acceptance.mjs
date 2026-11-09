/**
 * 动画统一验收（真实 Chrome）：效果与切换共用同一套驱动——Web Animations
 * `currentTime` 精确寻址到 t=0 / 0.5 / 1，断言计算样式端点 == 关键帧声明、
 * 中点命中精确中间帧或严格处于两端之间、painted 几何（getBoundingClientRect）
 * 落在预期位置。未来新增动画效果只要进 `sample-animation-effects.pptx`
 * 固件矩阵，这里自动纳入验收，无需新写用例。
 *
 * 截图取证落盘 out/animation-acceptance/midpoints/（代表性效果 × t=0.5），
 * 供人工复核；不做跨机器像素基线（抗锯齿漂移），几何正确性由包围盒断言保证。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { withChartBrowser } from './lib/chart-browser-lab.mjs';
import { recordCount } from './lib/measured.mjs';

const root = resolve('.');
const out = join(root, 'out/animation-acceptance');
mkdirSync(out, { recursive: true });
const dist = process.argv.includes('--dist');
const entry = join(out, 'entry.mjs');
writeFileSync(entry, `export { parse, renderSlideToSvg } from '${root}/packages/core/src/index.ts';
export { framesFor, playGroup, playTransitionControlled, transitionFrames, settledDeclaration } from '${root}/packages/viewer-core/src/index.ts';
export { createAnimationAcceptance, TRANSITION_TYPES } from '${root}/tooling/lib/animation-acceptance-browser.mjs';`);
await bundleBrowser({
  root,
  entry,
  output: join(out, 'contract.mjs'),
  aliases: dist ? [] : [
    ['@web-ppt/core', join(root, 'packages/core/src/index.ts')],
    ['@web-ppt/viewer-core', join(root, 'packages/viewer-core/src/index.ts')],
  ],
});

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { passed++; return; }
  failures.push(detail ? `${name} — ${detail}` : name);
};
const near = (a, b, tolerance = 2) => Math.abs(a - b) <= tolerance;
/** 离场锚点带 8px 容差：offSlideTransform 是整元素位移，允许边缘残影级别的重叠 */
const mostlyOff = (rect) => rect.x >= 1272 || rect.x + rect.w <= 8 || rect.y >= 712 || rect.y + rect.h <= 8;

/** 入场几何矩阵：t=0 的出发点与 t=1 的落点，按效果族断言 painted 包围盒。
 *  zoom 只对真实缩放（无方向）生效：box-in/out 走蒙版，包围盒不变。 */
const GEOMETRY = {  fly: (s0, s1, base) => {
    check('fly 起点整体在画布外', mostlyOff(s0.rect), JSON.stringify(s0.rect));
    check('fly 终点回到原位', near(s1.rect.x, base.rect.x) && near(s1.rect.y, base.rect.y) && near(s1.rect.w, base.rect.w));
  },
  float: (s0, s1, base) => {
    check('float 起点不在原位（从边外滑入）', !near(s0.rect.y, base.rect.y, 4), `${s0.rect.y} vs ${base.rect.y}`);
    check('float 终点回到原位', near(s1.rect.y, base.rect.y) && near(s1.rect.x, base.rect.x));
  },
  bounce: (s0, s1, base) => {
    check('bounce 起点悬在上方', s0.rect.y < base.rect.y - 40, `${s0.rect.y} vs ${base.rect.y}`);
    check('bounce 终点回到原位', near(s1.rect.y, base.rect.y) && near(s1.rect.x, base.rect.x));
  },
  zoom: (s0, s1, base) => {
    check('zoom 起点明显小于原尺寸', s0.rect.w < base.rect.w * 0.6 || s0.rect.h < base.rect.h * 0.6, JSON.stringify(s0.rect));
    // 放大旋转（grow-turn）带 90° 旋转，包围盒宽高互换；普通 zoom 终点还原
    const restored = near(s1.rect.w, base.rect.w) && near(s1.rect.h, base.rect.h);
    const swapped = near(s1.rect.w, base.rect.h) && near(s1.rect.h, base.rect.w);
    check('zoom 终点恢复原尺寸（含旋转互换）', restored || swapped, JSON.stringify(s1.rect));
  },
  grow: (s0, s1, base) => {
    check('grow 起点缩小', s0.rect.w < base.rect.w * 0.9 || s0.rect.h < base.rect.h * 0.9, JSON.stringify(s0.rect));
    const restored = near(s1.rect.w, base.rect.w) && near(s1.rect.h, base.rect.h);
    const swapped = near(s1.rect.w, base.rect.h) && near(s1.rect.h, base.rect.w);
    check('grow 终点恢复原尺寸（放大旋转按 90° 互换）', restored || swapped, JSON.stringify(s1.rect));
  },
  stretch: (s0, s1, base) => {
    check('stretch 起点至少一轴塌缩', s0.rect.w < base.rect.w * 0.5 || s0.rect.h < base.rect.h * 0.5, JSON.stringify(s0.rect));
    check('stretch 终点恢复原尺寸', near(s1.rect.w, base.rect.w) && near(s1.rect.h, base.rect.h));
  },
};

/** 截图取证样本：从效果固件里按页与效果名定位（人工复核用） */
const SCREENSHOT_SAMPLES = [
  { name: 'fly', pick: (s) => s.slide === 0 && s.effect === 'fly' },
  { name: 'blinds', pick: (s) => s.slide === 1 && s.effect === 'blinds' },
  { name: 'circle', pick: (s) => s.slide === 2 && s.effect === 'circle' && s.kind === 'entrance' },
  { name: 'wheel', pick: (s) => s.slide === 3 && s.effect === 'wheel' },
  { name: 'fade', pick: (s) => s.slide === 4 && s.effect === 'fade' },
  { name: 'stretch', pick: (s) => s.slide === 6 && s.effect === 'stretch' && s.kind === 'entrance' },
  { name: 'exit-circle', pick: (s) => s.slide === 5 && s.effect === 'circle' && s.kind === 'exit' },
];

function pick(sample) {
  if (!sample) return null;
  const { opacity, transform, clipPath, maskSize } = sample;
  return { opacity, transform, clipPath, maskSize };
}
/** none ≡ 单位矩阵；其余按 6 个分量做数值比较（消除序列化差异） */
function transformEquals(a, b) {
  const identity = [1, 0, 0, 1, 0, 0];
  const parse = (v) => (v === 'none' || !v ? identity
    : (v.match(/matrix\(([^)]+)\)/)?.[1] ?? '').split(',').map(Number)).map((n) => Number.isFinite(n) ? n : null);
  const pa = parse(a), pb = parse(b);
  if (pa.some(Number.isNaN) || pb.some(Number.isNaN)) return a === b;
  return pa.every((n, i) => Math.abs(n - pb[i]) < 1e-4);
}
/** 零值裁剪 / 蒙版的 token 化比较：丢弃零值 token，'inset(0% 0px)' ≡ 'inset(0px)' ≡ 'inset(0)' */
const clipTokens = (v) => (String(v).match(/-?[\d.]+(?:px|%)?/g) ?? [])
  .filter((token) => parseFloat(token) !== 0).join(',');
function sameInNode(got, want) {
  if (!got || !want) return false;
  if (want.opacity !== undefined && Math.abs(parseFloat(got.opacity) - parseFloat(want.opacity)) > 1e-4) return false;
  if (want.transform !== undefined && !transformEquals(got.transform, want.transform)) return false;
  for (const channel of ['clipPath', 'maskSize']) {
    if (want[channel] !== undefined && clipTokens(got[channel]) !== clipTokens(want[channel])) return false;
  }
  return true;
}

const TRANSITION_TYPES = [
  'none', 'fade', 'cut', 'push', 'pull', 'cover', 'wipe', 'split', 'zoom', 'dissolve',
  'checker', 'blinds', 'comb', 'wheel', 'circle', 'diamond', 'plus', 'wedge',
  'newsflash', 'randomBar', 'strips',
  'vortex', 'switch', 'flip', 'ripple', 'honeycomb', 'glitter', 'warp', 'flythrough',
  'flash', 'shred', 'reveal', 'wheelReverse', 'ferris', 'gallery', 'conveyor', 'pan',
  'doors', 'window', 'prism', 'morph',
];

await withChartBrowser(root, async (browser) => {
  await browser.request('Page.enable');
  const init = await browser.evaluate(`(async () => {
    const m = await import('/out/animation-acceptance/contract.mjs');
    window.__anim = m.createAnimationAcceptance(m);
    const deck = await window.__anim.openDeck('deck', await (await fetch('/fixtures/sample-animation-effects.pptx')).arrayBuffer());
    const showcase = await window.__anim.openDeck('showcase', await (await fetch('/fixtures/showcase.pptx')).arrayBuffer());
    return { deck, showcase };
  })()`);
  const { deck, showcase } = init;
  check('效果固件七页全解析', deck.slides === 7, `实际 ${deck.slides} 页`);
  check('效果固件动画步骤 ≥45', deck.steps.length >= 45, `实际 ${deck.steps.length}`);
  check('showcase 存在动画与切换', showcase.steps.length >= 8 && showcase.transitions >= 7,
    `steps=${showcase.steps.length} transitions=${showcase.transitions}`);

  const steps = [...deck.steps, ...showcase.steps];
  const mounted = new Map();
  const samples = new Map();
  for (const step of steps) {
    const deckName = deck.steps.includes(step) ? 'deck' : 'showcase';
    const key = `${deckName}:${step.slide}:${step.target}`;
    if (!mounted.has(key)) {
      await browser.evaluate(`window.__anim.mountSlide(${JSON.stringify(deckName)}, ${step.slide})`);
      mounted.set(key, true);
    }
    const byTarget = new Map();
    for (const t of [0, 0.5, 1]) {
      const sample = await browser.evaluate(`window.__anim.sampleStep(${step.target}, ${t})`);
      byTarget.set(t, sample);
      if (sample.missing !== undefined) check(`步骤 ${step.target} 节点存在`, false, `missing ${sample.missing}`);
      if (sample.noAnimation !== undefined) check(`步骤 ${step.target} 产生 Web Animations`, false, 'noAnimation');
    }
    samples.set(key, { step, byTarget });
  }

  // ---- 端点 + 中点 + 文本宿主：所有步骤统一断言 ----
  for (const [, { step, byTarget }] of samples) {
    const label = `${step.effect}/${step.kind}#${step.target}`;
    const s0 = byTarget.get(0), sm = byTarget.get(0.5), s1 = byTarget.get(1);
    if (s0.missing !== undefined || s0.noAnimation !== undefined) continue;
    check(`${label} t=0 计算样式等于 from 声明`, !!s0.want && sameInNode(s0.got, s0.want),
      JSON.stringify({ got: pick(s0.got), want: s0.want }));
    check(`${label} t=1 计算样式等于 to 声明`, !!s1.want && sameInNode(s1.got, s1.want),
      JSON.stringify({ got: pick(s1.got), want: s1.want }));
    check(`${label} 播放中元素可见`, s0.got.visibility === 'visible' && s1.got.visibility === 'visible');
    // 蒙版 / 裁剪类效果的文字必须随形状一起被裁剪（文字在 foreignObject 里，
    // 只裁形状会露出完整文字）；位移 / 透明度类由节点级动画整体携带
    const MASK_FAMILY = ['blinds', 'checkerboard', 'box', 'circle', 'diamond', 'plus',
      'wheel', 'strips', 'split', 'dissolve', 'randomBar', 'wipe'];
    check(`${label} 文本宿主随形状一起动画`,
      step.kind === 'entrance' && MASK_FAMILY.includes(step.effect) ? s0.animationCount >= 2 : s0.animationCount >= 1,
      `animations=${s0.animationCount}`);

    if (sm.midWant && sm.linear) {
      check(`${label} t=0.5 命中精确中间帧`, sameInNode(sm.got, sm.midWant),
        JSON.stringify({ got: pick(sm.got), want: sm.midWant }));
    } else if (!sm.linear) {
      const fromO = parseFloat(s0.want?.opacity ?? s1.got.opacity);
      const toO = parseFloat(s1.want?.opacity ?? s0.got.opacity);
      const midO = parseFloat(sm.got.opacity);
      if (Number.isFinite(fromO) && Number.isFinite(toO) && Math.abs(fromO - toO) > 1e-6) {
        check(`${label} t=0.5 透明度严格介于两端（缓动在起作用）`,
          midO > Math.min(fromO, toO) && midO < Math.max(fromO, toO),
          `mid=${midO} from=${fromO} to=${toO}`);
      }
      const t0T = s0.want?.transform, t1T = s1.want?.transform;
      if (t0T && t1T && t0T !== t1T) {
        check(`${label} t=0.5 transform 不同于任一端点`,
          sm.got.transform !== t0T && sm.got.transform !== t1T, sm.got.transform);
      }
    }

    if (s1.settled) {
      check(`${label} 强调终态与 settledDeclaration 一致`, sameInNode(s1.got, s1.settled),
        JSON.stringify({ got: pick(s1.got), settled: s1.settled }));
    }
  }

  // ---- 几何断言：painted 包围盒按效果族核对 ----
  for (const [key, { step, byTarget }] of samples) {
    const s0 = byTarget.get(0), sm = byTarget.get(0.5), s1 = byTarget.get(1);
    if (s0.missing !== undefined || s0.noAnimation !== undefined) continue;
    if (!s0.base) { check(`步骤 ${key} 有未动画基准`, false, JSON.stringify(pick(s0.got))); continue; }
    const base = s0.base;
    const geometry = GEOMETRY[step.effect === 'spin-in' ? 'spin' : step.effect];
    if (geometry && step.kind === 'entrance'
      // 盒状映射的 zoom 走蒙版揭开，包围盒不动；只有无方向的真实缩放才有尺寸变化
      && !(step.effect === 'zoom' && step.dir)) geometry(s0.got, s1.got, base);
    if (step.kind === 'exit' && step.effect !== 'stretch') {
      // 伸展退场沿锚边缩回，包围盒必然变化（端点断言已核对 to 变换）；蒙版类退场不动位置
      check(`退场 ${step.effect}#${step.target} 包围盒不变（退场不改位置）`,
        near(s1.got.rect.x, base.rect.x, 4) && near(s1.got.rect.y, base.rect.y, 4),
        JSON.stringify({ got: s1.got.rect, base: base.rect }));
    }
    if (step.pathEnd) {
      const dx = step.pathEnd[0], dy = step.pathEnd[1];
      check(`motionPath#${step.target} 终点位移等于路径末点`,
        near(s1.got.rect.x - base.rect.x, dx, 3) && near(s1.got.rect.y - base.rect.y, dy, 3),
        `位移 (${s1.got.rect.x - base.rect.x}, ${s1.got.rect.y - base.rect.y}) vs (${dx}, ${dy})`);
      check(`motionPath#${step.target} 中点在移动`,
        !near(sm.got.rect.x, base.rect.x, 1) || !near(sm.got.rect.y, base.rect.y, 1));
    }
  }

  // ---- 切换：全部类型 × 三个方向 × 三个时间点，两层分别核对 ----
  await browser.evaluate(`window.__anim.mountSlide('showcase', ${showcase.steps[0]?.slide ?? 0})`);
  for (const type of TRANSITION_TYPES) {
    for (const dir of ['l', 'u', 'horz-out']) {
      const byT = new Map();
      for (const t of [0, 0.5, 1]) {
        byT.set(t, await browser.evaluate(
          `window.__anim.sampleTransition(${JSON.stringify(type)}, ${JSON.stringify(dir)}, ${t})`));
      }
      const s0 = byT.get(0), sm = byT.get(0.5), s1 = byT.get(1);
      const label = `切换 ${type}${dir === 'horz-out' ? '/horz-out' : `/${dir}`}`;
      if (s0.skip) {
        // none 的契约就是无切换动画：跳过是正确行为；其余类型必须有动画
        if (type === 'none') { passed++; continue; }
        check(`${label} 产出关键帧`, false, '无动画');
        continue;
      }
      if (s0.morph) {
        // morph 没有层级动画：子元素透明度总和是配对进度的确定性聚合
        check(`${label} t=0.5 元素在配对移动`, Math.abs(sm.opacitySum - s0.opacitySum) > 1e-3,
          `sum ${s0.opacitySum.toFixed(2)} → ${sm.opacitySum.toFixed(2)}`);
        check(`${label} t=1 与起点不同（配对完成）`, Math.abs(s1.opacitySum - s0.opacitySum) > 1e-3,
          `sum ${s0.opacitySum.toFixed(2)} → ${s1.opacitySum.toFixed(2)}`);
        check('morph 走逐元素配对补间（动画数多于两层）', s0.animationCount > 2, `animations=${s0.animationCount}`);
        continue;
      }
      check(`${label} 进场层 t=0 等于 from 声明`, sameInNode(s0.incoming, s0.wantIn0),
        JSON.stringify({ got: pick(s0.incoming), want: s0.wantIn0 }));
      check(`${label} 进场层 t=1 等于 to 声明且完全入场`,
        sameInNode(s1.incoming, s1.wantIn1) && parseFloat(s1.incoming.opacity) === 1,
        JSON.stringify({ got: pick(s1.incoming), want: s1.wantIn1 }));
      if (sm.midWantIn) {
        check(`${label} 进场层 t=0.5 命中精确中间帧`, sameInNode(sm.incoming, sm.midWantIn),
          JSON.stringify({ got: pick(sm.incoming), want: sm.midWantIn }));
      } else {
        // 蒙版 / 裁剪类切换的运动可能在退场层（wipe / split 把旧页裁走）：
        // 任一层相对 t=0 有通道变化即在运动中
        const moved = (a, b) => a !== null && b !== null
          && (a.transform !== b.transform || a.clipPath !== b.clipPath || a.maskSize !== b.maskSize
            || Math.abs(parseFloat(a.opacity) - parseFloat(b.opacity)) > 1e-4);
        check(`${label} t=0.5 处于运动中（进场或退场层）`,
          moved(sm.incoming, s0.incoming) || moved(sm.incoming, s1.incoming)
            || moved(sm.outgoing, s0.outgoing),
          `mid in=${sm.incoming.transform}/${sm.incoming.clipPath} out=${sm.outgoing?.clipPath}`);
      }
      if (s1.outgoing) {
        check(`${label} 退场层 t=1 等于 to 声明`, sameInNode(s1.outgoing, s1.wantOut1),
          JSON.stringify({ got: pick(s1.outgoing), want: s1.wantOut1 }));
      }
      if (type === 'morph') {
        check('morph 走逐元素配对补间（动画数多于两层）', s0.animationCount > 2, `animations=${s0.animationCount}`);
      }
    }
  }

  // ---- 截图取证：代表性效果的 t=0.5 中间态落盘 ----
  const screenshotDir = join(out, 'midpoints');
  mkdirSync(screenshotDir, { recursive: true });
  for (const { name, pick: predicate } of SCREENSHOT_SAMPLES) {
    const step = deck.steps.find(predicate);
    if (!step) { check(`截图样本 ${name} 存在`, false, '固件里没找到'); continue; }
    await browser.evaluate(`window.__anim.mountSlide('deck', ${step.slide})`);
    const seeked = await browser.evaluate(`window.__anim.sampleStep(${step.target}, 0.5)`);
    if (seeked.missing !== undefined || seeked.noAnimation !== undefined) continue;
    const shot = await browser.request('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(screenshotDir, `${name}-t0.5.png`), Buffer.from(shot.data, 'base64'));
    passed++;
  }
});

if (failures.length) {
  console.error(`\x1b[31m✗ 动画统一验收失败（${failures.length} 项）\x1b[0m`);
  for (const failure of failures.slice(0, 40)) console.error(`  · ${failure}`);
  if (failures.length > 40) console.error(`  … 另有 ${failures.length - 40} 项`);
  process.exit(1);
}
recordCount('animationAcceptance', passed);
console.log(`\x1b[32m✓ 动画统一验收 ${passed} 项断言通过（${dist ? '发布产物' : '源码'}；截图在 out/animation-acceptance/midpoints/）\x1b[0m`);
