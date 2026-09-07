import { compose, esc, ID_MAT, n } from '../gdi';
import type { Mat } from '../gdi';
import { Bytes, color, unitScale } from './binary';
import type { Box } from './binary';
import { arc, pathData, spline } from './geometry';
import { ObjectTable } from './objects';
import { id, paint, stroke, transform } from './paint';
import { fontAttrs, textLayout } from './text';

interface State { world: Mat; sx: number; sy: number; clip: string | null }
export class EmfPlus {
  active = false;
  dual = false;
  getDC = false;
  ended = false;
  dpiX = 96; dpiY = 96;
  readonly objects = new ObjectTable();
  readonly defs: string[] = [];
  state: State = { world: [...ID_MAT], sx: 1, sy: 1, clip: null };
  private stack: { id: number; container: boolean; state: State }[] = [];
  constructor(private bounds: Box, private emit: (svg: string) => void, private clear: () => void) {}
  matrix(): Mat { return compose(this.state.world, [this.state.sx, 0, 0, this.state.sy, 0, 0]); }
  private add(svg: string, matrix = this.matrix()): void {
    this.emit(`<g${this.state.clip ? ` clip-path="url(#${this.state.clip})"` : ''}><g transform="${transform(matrix)}">${svg}</g></g>`);
  }
  private fill(r: Bytes, flags: number): string {
    const value = r.u32(); return flags & 0x8000 ? color(value) : paint(this.objects.get(value, 1), this.defs);
  }
  private stroke(id: number): string { return stroke(this.objects.get(id, 2), this.dpiY, this.state.sy, this.defs); }
  private clip(svg: string, mode: number): void {
    if (mode !== 0 && mode !== 1) throw new Error('EMF+ 暂不支持该裁剪组合');
    const key = id(), parent = mode === 1 ? this.state.clip : null;
    // clipPath 不接受 g 子元素；直接变换轮廓，交集通过 clipPath 自身继承前一裁剪。
    this.defs.push(`<clipPath id="${key}"${parent ? ` clip-path="url(#${parent})"` : ''}>${svg.replace(/^<(\w+)/, `<$1 transform="${transform(this.matrix())}"`)}</clipPath>`);
    this.state.clip = key;
  }
  record(type: number, flags: number, bytes: Uint8Array): void {
    const r = new Bytes(bytes), object = flags & 255, compact = !!(flags & 0x4000);
    this.getDC = false;
    if (type === 0x4001) {
      if (this.active) throw new Error('EMF+ 重复头记录');
      this.active = true; this.dual = !!(flags & 1); r.take(8); this.dpiX = r.u32(); this.dpiY = r.u32();
      if (!this.dpiX || !this.dpiY || this.dpiX > 100000 || this.dpiY > 100000) throw new Error('EMF+ 非法 DPI');
      return;
    }
    if (!this.active || this.ended) throw new Error('EMF+ 记录顺序错误');
    if (type === 0x4002) { this.objects.finish(); this.ended = true; return; }
    if (type === 0x4003) return;
    if (type === 0x4008) { this.objects.set(flags, bytes); return; }
    if (type === 0x4009) {
      const fill = color(r.u32()); this.clear();
      this.emit(`<rect ${rectAttrs(this.bounds)} fill="${fill}"/>`); return;
    }
    if (type === 0x400a || type === 0x400b) {
      const attrs = type === 0x400a ? `fill="${this.fill(r, flags)}"` : this.stroke(object), count = r.count();
      for (let i = 0; i < count; i++) this.add(`<rect ${rectAttrs(r.rect(compact))} ${attrs}/>`);
      return;
    }
    if (type === 0x400c || type === 0x400d || type === 0x4019) {
      const attrs = type === 0x400c ? `fill="${this.fill(r, flags)}" fill-rule="${flags & 0x2000 ? 'nonzero' : 'evenodd'}"` : this.stroke(object);
      const points = r.points(r.count(), flags), types = type === 0x4019 ? points.map((_, i) => i ? 3 : 0) : undefined;
      this.add(`<path d="${pathData(points, types, type === 0x400c || type === 0x400d && !!(flags & 0x2000))}" ${attrs}/>`); return;
    }
    if (type === 0x400e || type === 0x400f) {
      const attrs = type === 0x400e ? `fill="${this.fill(r, flags)}"` : this.stroke(object), b = r.rect(compact);
      this.add(`<ellipse cx="${n(b.x + b.w / 2)}" cy="${n(b.y + b.h / 2)}" rx="${n(Math.abs(b.w / 2))}" ry="${n(Math.abs(b.h / 2))}" ${attrs}/>`); return;
    }
    if (type >= 0x4010 && type <= 0x4012) {
      const attrs = type === 0x4010 ? `fill="${this.fill(r, flags)}"` : this.stroke(object), start = r.f32(), sweep = r.f32();
      this.add(`<path d="${arc(r.rect(compact), start, sweep, type !== 0x4012)}" ${attrs}/>`); return;
    }
    if (type === 0x4014 || type === 0x4015) {
      const attrs = type === 0x4014 ? `fill="${this.fill(r, flags)}" fill-rule="evenodd"` : this.stroke(r.u32());
      this.add(`<path d="${this.objects.get(object, 3)}" ${attrs}/>`); return;
    }
    if (type >= 0x4016 && type <= 0x4018) {
      const attrs = type === 0x4016 ? `fill="${this.fill(r, flags)}" fill-rule="${flags & 0x2000 ? 'nonzero' : 'evenodd'}"` : this.stroke(object);
      const tension = r.f32(), offset = type === 0x4018 ? r.count() : 0, segments = type === 0x4018 ? r.count() : undefined;
      this.add(`<path d="${spline(r.points(r.count(), flags), tension, type !== 0x4018, offset, segments)}" ${attrs}/>`); return;
    }
    if (type === 0x401a || type === 0x401b) {
      const attrs = r.u32(); if (attrs !== 0xffffffff) throw new Error('EMF+ 图片颜色变换暂不支持');
      if (r.u32() !== 2) throw new Error('EMF+ 图片来源必须为像素');
      const source = r.rect(), image = this.objects.get(object, 5); let dest: Mat;
      if (type === 0x401a) { const b = r.rect(compact); dest = [b.w, 0, 0, b.h, b.x, b.y]; }
      else { if (r.count() !== 3) throw new Error('EMF+ 图片目标不是三点'); const [a, b, c] = r.points(3, flags); dest = [b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y, a.x, a.y]; }
      if (source.w <= 0 || source.h <= 0) throw new Error('EMF+ 图片裁剪无效');
      this.add(`<svg width="1" height="1" viewBox="${[source.x, source.y, source.w, source.h].map(n).join(' ')}" preserveAspectRatio="none" overflow="hidden"><image href="${image.href}" x="0" y="0"${image.width > 0 && image.height > 0 ? ` width="${image.width}" height="${image.height}"` : ''}/></svg>`, compose(dest, this.matrix())); return;
    }
    if (type === 0x401c) {
      const fill = this.fill(r, flags), formatId = r.u32(), length = r.count(), box = r.rect(), text = r.text(length);
      const font = this.objects.get(object, 6), format = formatId === 0xffffffff ? { flags: 0, align: 0, lineAlign: 0 } : this.objects.get(formatId, 7);
      const size = font.size * unitScale(font.unit, this.dpiY) / this.state.sy;
      const saved = this.state.clip;
      if (!(format.flags & 0x4000) && box.w > 0 && box.h > 0) this.clip(`<rect ${rectAttrs(box)}/>`, 1);
      this.add(`<text xml:space="preserve" fill="${fill}" ${fontAttrs(font, size)}>${textLayout(text, box, size, format)}</text>`);
      this.state.clip = saved; return;
    }
    if (type === 0x4036) {
      const fill = this.fill(r, flags), options = r.u32(), matrix = r.u32(), count = r.count();
      if (!(options & 1) || options & ~1) throw new Error('EMF+ 字形索引/竖排驱动文本暂不支持');
      const text = r.text(count), points = r.points(count, 0), extra = matrix ? r.matrix() : ID_MAT;
      const font = this.objects.get(object, 6), size = font.size * unitScale(font.unit, this.dpiY) / this.state.sy;
      this.add(`<text fill="${fill}" ${fontAttrs(font, size)}>${points.map((p, i) => `<tspan x="${n(p.x)}" y="${n(p.y)}">${esc(text[i] ?? '')}</tspan>`).join('')}</text>`, compose(extra, this.matrix())); return;
    }
    this.control(type, flags, r);
  }
  private control(type: number, flags: number, r: Bytes): void {
    if (type >= 0x401d && type <= 0x4022 || type === 0x4024) return;
    if (type === 0x4004) { this.getDC = true; return; }
    if (type === 0x4023) { if (flags & 255) throw new Error('EMF+ SourceCopy 暂不支持'); return; }
    if (type === 0x4025 || type === 0x4028 || type === 0x4027) {
      let map: Mat | undefined;
      if (type === 0x4027) {
        const d = r.rect(), s = r.rect(), ux = unitScale(flags & 255, this.dpiX) / this.state.sx, uy = unitScale(flags & 255, this.dpiY) / this.state.sy;
        if (!s.w || !s.h) throw new Error('EMF+ 容器来源为空');
        map = [d.w / (s.w * ux), 0, 0, d.h / (s.h * uy), d.x - s.x * d.w / s.w, d.y - s.y * d.h / s.h];
      }
      if (this.stack.length > 1024) throw new Error('EMF+ 状态栈超限');
      this.stack.push({ id: r.u32(), container: type !== 0x4025, state: { ...this.state, world: [...this.state.world] } });
      if (map) this.state.world = compose(map, this.state.world); return;
    }
    if (type === 0x4026 || type === 0x4029) {
      const id = r.u32(); let at = this.stack.length - 1;
      while (at >= 0 && (this.stack[at].id !== id || this.stack[at].container !== (type === 0x4029))) at--;
      if (at < 0) throw new Error('EMF+ 状态恢复失效');
      this.state = this.stack[at].state; this.stack.length = at; return;
    }
    if (type === 0x402b) { this.state.world = [...ID_MAT]; return; }
    if (type === 0x4030) {
      const scale = r.f32(); if (scale <= 0) throw new Error('EMF+ 非法页面比例');
      this.state.sx = scale * unitScale(flags & 255, this.dpiX); this.state.sy = scale * unitScale(flags & 255, this.dpiY); return;
    }
    if (type >= 0x402a && type <= 0x402f) {
      let m: Mat;
      if (type === 0x402a || type === 0x402c) m = r.matrix();
      else if (type === 0x402d) m = [1, 0, 0, 1, r.f32(), r.f32()];
      else if (type === 0x402e) m = [r.f32(), 0, 0, r.f32(), 0, 0];
      else { const a = r.f32() * Math.PI / 180; m = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]; }
      this.state.world = type === 0x402a ? m : flags & 0x2000 ? compose(this.state.world, m) : compose(m, this.state.world); return;
    }
    if (type === 0x4031) { this.state.clip = null; return; }
    if (type === 0x4032) { this.clip(`<rect ${rectAttrs(r.rect())}/>`, (flags >>> 8) & 15); return; }
    if (type === 0x4033) { this.clip(`<path d="${this.objects.get(flags & 255, 3)}" fill-rule="evenodd"/>`, (flags >>> 8) & 15); return; }
    throw new Error(`EMF+ 暂不支持记录 0x${type.toString(16)}`);
  }
}
function rectAttrs(b: Box): string { return `x="${n(b.x)}" y="${n(b.y)}" width="${n(Math.max(0, b.w))}" height="${n(Math.max(0, b.h))}"`; }
