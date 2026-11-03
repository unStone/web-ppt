import { open } from 'node:fs/promises';

export async function createProtocolLog(path) {
  // 每个 run 只能有一个 host；复用日志会混入旧会话，自动重连也必须重新建 run。
  const file = await open(path, 'wx');
  let sequence = 0;
  let tail = Promise.resolve();
  return {
    write(record) {
      const entry = { version: 1, sequence: ++sequence, ...record };
      tail = tail.then(() => file.write(`${JSON.stringify(entry)}\n`));
      return tail;
    },
    async close() {
      try {
        await tail;
      } finally {
        await file.close();
      }
    },
  };
}
