export const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

/** 替代浏览器注册边界；编辑、历史、文件和恢复继续执行真实实现。 */
export function fakeModelContext() {
  const tools = new Map();
  let failAt = -1, calls = 0, gate;
  return {
    tools,
    failAt(value) { failAt = value; calls = 0; },
    hold(value) { gate = value; },
    async registerTool(tool, options = {}) {
      const current = ++calls;
      if (gate) { gate.entered?.resolve(); await gate.promise; }
      if (options.signal?.aborted) throw new DOMException('注册已经取消', 'AbortError');
      if (current === failAt) throw new Error('验收模拟平台注册失败');
      if (tools.has(tool.name)) throw new Error(`工具重复注册：${tool.name}`);
      tools.set(tool.name, tool);
      options.signal?.addEventListener('abort', () => {
        if (tools.get(tool.name) === tool) tools.delete(tool.name);
      }, { once: true });
    },
    async getTools() { return [...tools.values()]; },
    async executeTool(tool, input = {}, options = {}) {
      if (tools.get(tool.name) !== tool) throw new DOMException('工具已经注销', 'NotFoundError');
      return JSON.stringify(await tool.execute(input, { signal: options.signal ?? new AbortController().signal }));
    },
  };
}
