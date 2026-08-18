/** OLE2 / CFB（复合文档）读取器：FAT / MiniFAT / 目录 */

const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

export class Cfb {
  private view: DataView;
  private bytes: Uint8Array;
  private sectorSize: number;
  private miniSectorSize: number;
  private miniCutoff: number;
  private fat: number[] = [];
  private miniFat: number[] = [];
  private dir: { name: string; type: number; start: number; size: number }[] = [];
  private miniStream: Uint8Array = new Uint8Array(0);

  constructor(bytes: Uint8Array) {
    if (bytes.length < 512 || bytes[0] !== 0xd0 || bytes[1] !== 0xcf) {
      throw new Error('不是有效的 CFB 复合文档');
    }
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.sectorSize = 1 << this.view.getUint16(30, true);
    this.miniSectorSize = 1 << this.view.getUint16(32, true);
    this.miniCutoff = this.view.getUint32(56, true);
    this.readFat();
    this.readDirectory();
    this.readMiniFat();
  }

  private offsetOf(sect: number): number {
    return (sect + 1) * this.sectorSize;
  }

  private readFat(): void {
    const difat: number[] = [];
    for (let i = 0; i < 109; i++) difat.push(this.view.getUint32(76 + i * 4, true));
    let sect = this.view.getUint32(68, true);
    const per = this.sectorSize / 4;
    let guard = 0;
    while (sect !== ENDOFCHAIN && sect !== FREESECT && guard++ < 100000) {
      const o = this.offsetOf(sect);
      if (o + this.sectorSize > this.bytes.length) break;
      for (let i = 0; i < per - 1; i++) difat.push(this.view.getUint32(o + i * 4, true));
      sect = this.view.getUint32(o + (per - 1) * 4, true);
    }
    for (const s of difat) {
      if (s === FREESECT || s === ENDOFCHAIN) continue;
      const o = this.offsetOf(s);
      if (o + this.sectorSize > this.bytes.length) continue;
      for (let i = 0; i < per; i++) this.fat.push(this.view.getUint32(o + i * 4, true));
    }
  }

  private chain(start: number, fat: number[]): number[] {
    const out: number[] = [];
    let s = start;
    let guard = 0;
    while (s !== ENDOFCHAIN && s !== FREESECT && s >= 0 && s < fat.length && guard++ < 1_000_000) {
      out.push(s);
      s = fat[s];
    }
    return out;
  }

  private readChain(start: number, size: number): Uint8Array {
    const sects = this.chain(start, this.fat);
    const out = new Uint8Array(sects.length * this.sectorSize);
    sects.forEach((s, i) => {
      const o = this.offsetOf(s);
      out.set(this.bytes.subarray(o, Math.min(o + this.sectorSize, this.bytes.length)), i * this.sectorSize);
    });
    return out.subarray(0, size);
  }

  private readDirectory(): void {
    const start = this.view.getUint32(48, true);
    const sects = this.chain(start, this.fat);
    const raw = this.readChain(start, sects.length * this.sectorSize);
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for (let off = 0; off + 128 <= raw.length; off += 128) {
      const nameLen = dv.getUint16(off + 64, true);
      if (nameLen === 0 || nameLen > 64) continue;
      let name = '';
      for (let i = 0; i < nameLen - 2; i += 2) name += String.fromCharCode(dv.getUint16(off + i, true));
      this.dir.push({
        name,
        type: dv.getUint8(off + 66),
        start: dv.getUint32(off + 116, true),
        size: dv.getUint32(off + 120, true),
      });
    }
  }

  private readMiniFat(): void {
    const start = this.view.getUint32(60, true);
    if (start !== ENDOFCHAIN && start !== FREESECT) {
      const sects = this.chain(start, this.fat);
      const raw = this.readChain(start, sects.length * this.sectorSize);
      const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      for (let i = 0; i + 4 <= raw.length; i += 4) this.miniFat.push(dv.getUint32(i, true));
    }
    const root = this.dir.find((e) => e.type === 5);
    if (root) this.miniStream = this.readChain(root.start, root.size);
  }

  streamNames(): string[] {
    return this.dir.filter((e) => e.type === 2).map((e) => e.name);
  }

  stream(name: string): Uint8Array | null {
    const entry = this.dir.find((e) => e.type === 2 && e.name.toLowerCase() === name.toLowerCase());
    if (!entry) return null;
    if (entry.size >= this.miniCutoff) return this.readChain(entry.start, entry.size);
    const sects = this.chain(entry.start, this.miniFat);
    const out = new Uint8Array(sects.length * this.miniSectorSize);
    sects.forEach((s, i) => {
      out.set(
        this.miniStream.subarray(s * this.miniSectorSize, (s + 1) * this.miniSectorSize),
        i * this.miniSectorSize,
      );
    });
    return out.subarray(0, entry.size);
  }
}
