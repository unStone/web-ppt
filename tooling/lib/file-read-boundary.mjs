let sequence = 0;

/** 只暂停指定真实 File 的字节读取，保留格式解析/编辑命令；每个作用域统一释放回调与原型。 */
export async function withDelayedFileRead({ evaluate, waitFor }, name, action) {
  const key = `__siteFileRead${++sequence}`;
  const state = `globalThis[${JSON.stringify(key)}]`;
  await evaluate(`(() => {
    const original = File.prototype.arrayBuffer;
    const state = { original, reads: [] }; ${state} = state;
    File.prototype.arrayBuffer = function () {
      if (this.name !== ${JSON.stringify(name)}) return original.call(this);
      return new Promise((resolve, reject) => {
        const read = { reject, finish: () => read.completion ??= original.call(this).then(resolve, reject) };
        state.reads.push(read);
      });
    };
  })()`);
  try {
    await action({
      wait: (count = 1) => waitFor(`${state}.reads.length >= ${count}`, `${name} 文件读取等待`),
      finish: (index = 0) => evaluate(`${state}.reads[${index}].finish()`, true),
    });
  } finally {
    await evaluate(`(() => {
      const state = ${state}; File.prototype.arrayBuffer = state.original;
      for (const read of state.reads) read.reject(new DOMException('测试读取作用域已结束', 'AbortError'));
      delete ${state};
    })()`);
  }
}
