/**
 * 远程样本库清单的读取与校验，首页与样本页共用。
 *
 * 清单是别处来的数据，可以指向任意地址：能去拉取的源钉死在 `SAMPLE_ORIGINS`，
 * 其余字段一律当不可信文本处理（只走 textContent，不拼 HTML）。
 */

const SAMPLES_INDEX = 'https://unstone.github.io/web-ppt-samples/index.json';
const SAMPLE_ORIGINS = ['https://unstone.github.io', 'https://cdn.jsdelivr.net'];

export interface Sample {
  /** 已解析并校验过来源的绝对地址 */
  url: string;
  /** 文件名，用作首页深链的参数 */
  file: string;
  title: string;
  highlight: string;
  author: string;
  license: string;
  /** 原始出处；只保留 http(s)，其余（含 javascript:）一律丢掉 */
  source: string;
  /** 样本库标记的精选 */
  demo: boolean;
}

/**
 * 首页示例栏放这几个，其余去样本页挑。
 *
 * 按文件名钉死，不跟清单里的 `demo` 标记走：样本库会一直加，
 * 首页摆哪几个是官网自己的取舍——四种一眼能分辨的视觉风格，
 * 外加一个纯交互（内部跳页按钮）和一个装饰密度极高的。数组顺序即展示顺序。
 */
export const FEATURED = [
  'taste-grammar-gallery.pptx',   // 结构图谱（64 页）
  'swiss-grid-systems.pptx',      // 瑞士网格
  'glassmorphism-saas.pptx',      // 玻璃拟态
  'global-ai-capital.pptx',       // 暗色数据新闻
  'eddi-welcome-tutorial.pptx',   // EDDi 互动病例教程
  'sugar-rush-memphis.pptx',      // 孟菲斯风格
];

/**
 * 按 FEATURED 的顺序挑出首页要摆的条目。
 * 一个都没对上说明样本库改了文件名——那就退回清单自己标的精选，别把示例栏弄空。
 */
export function featuredOf(all: Sample[]): Sample[] {
  const hit = FEATURED.map((f) => all.find((s) => s.file === f)).filter((s): s is Sample => !!s);
  return hit.length ? hit : all.filter((s) => s.demo).slice(0, FEATURED.length);
}

/** 清单里的出处链接是外部数据，只认 http(s) */
function safeHttp(v: unknown): string {
  if (typeof v !== 'string') return '';
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch {
    return '';
  }
}

/** 取回清单；不可达时返回空数组（样本库挂了不该影响首页基线） */
export async function fetchSamples(): Promise<Sample[]> {
  let data: unknown;
  try {
    const res = await fetch(SAMPLES_INDEX);
    if (!res.ok) return [];
    data = await res.json();
  } catch {
    return [];
  }

  const doc = data as { base?: unknown; samples?: unknown };
  const base = typeof doc.base === 'string' ? doc.base : SAMPLES_INDEX;
  const raw = Array.isArray(doc.samples) ? doc.samples : [];

  const out: Sample[] = [];
  for (const item of raw) {
    const s = item as Record<string, unknown>;
    if (typeof s.file !== 'string' || typeof s.title !== 'string') continue;

    let url: URL;
    try { url = new URL(s.file, base); } catch { continue; }
    if (!SAMPLE_ORIGINS.includes(url.origin)) continue;

    out.push({
      url: url.href,
      file: s.file,
      title: s.title,
      highlight: typeof s.highlight === 'string' ? s.highlight : '',
      author: typeof s.author === 'string' ? s.author : '',
      license: typeof s.license === 'string' ? s.license : '',
      source: safeHttp(s.source),
      demo: s.demo === true,
    });
  }
  // 整份清单一个都没标 demo 时全当精选，免得旧版清单把示例栏弄空
  return out.some((s) => s.demo) ? out : out.map((s) => ({ ...s, demo: true }));
}
