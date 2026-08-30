import type { CollabMessage, CollabMessageListener, CollabProvider } from './types';

interface MessageEventLike { readonly data: unknown }
interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
  close(): void;
}
type BroadcastChannelConstructor = new (name: string) => BroadcastChannelLike;

/** 两个标签页零配置演示 provider；生产系统可替换为任何持久化或传输实现。 */
export class BroadcastChannelCollabProvider implements CollabProvider {
  private readonly channel: BroadcastChannelLike;
  private readonly listeners = new Set<CollabMessageListener>();
  private disposed = false;
  private readonly receive = (event: MessageEventLike): void => {
    for (const listener of [...this.listeners]) listener(event.data as CollabMessage);
  };

  constructor(name: string, Channel: BroadcastChannelConstructor = globalThis.BroadcastChannel) {
    if (typeof name !== 'string' || !name) throw new Error('BroadcastChannel 名称不能为空');
    if (typeof Channel !== 'function') throw new Error('当前环境不支持 BroadcastChannel');
    this.channel = new Channel(name);
    this.channel.addEventListener('message', this.receive);
  }

  send(message: CollabMessage): void {
    if (this.disposed) throw new Error('BroadcastChannel provider 已释放');
    this.channel.postMessage(message);
  }

  subscribe(listener: CollabMessageListener): () => void {
    if (this.disposed) throw new Error('BroadcastChannel provider 已释放');
    if (typeof listener !== 'function') throw new Error('协同消息订阅者必须是函数');
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.channel.removeEventListener('message', this.receive);
    this.listeners.clear();
    this.channel.close();
  }
}
