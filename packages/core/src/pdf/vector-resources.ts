type Kind = 'Font' | 'XObject' | 'ExtGState' | 'Shading';

/** 页、Form 和图案单元各自持有实际引用；不能把之前所有资源复制进每个新图案而产生平方增长。 */
export class VectorResources {
  private current = new Map<Kind,Map<string,number>>();
  use(kind:Kind,resource:{name:string; object:number}):void {
    let entries = this.current.get(kind);
    if (!entries) this.current.set(kind,entries = new Map());
    entries.set(resource.name,resource.object);
  }
  async capture(draw:()=>Promise<string>):Promise<{commands:string; resources:string}> {
    const parent = this.current; this.current = new Map();
    try {
      const commands = await draw();
      const resources = [...this.current].map(([kind,entries]) =>
        `/${kind} << ${[...entries].map(([name,id]) => `/${name} ${id} 0 R`).join(' ')} >>`).join(' ');
      return {commands,resources};
    } finally {this.current = parent;}
  }
}
