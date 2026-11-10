type Handler<T> = (payload: T) => void;

/** Küçük, tip güvenli EventEmitter */
export class TypedEmitter<Events extends { [K in keyof Events]: unknown }> {
  private handlers: { [K in keyof Events]?: Set<Handler<Events[K]>> } = {};

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    (this.handlers[event] ??= new Set()).add(handler);
    return () => this.off(event, handler);
  }

  once<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    const off = this.on(event, (p) => {
      off();
      handler(p);
    });
    return off;
  }

  off<K extends keyof Events>(event: K, handler: Handler<Events[K]>): void {
    this.handlers[event]?.delete(handler);
  }

  protected emit<K extends keyof Events>(event: K, ...args: Events[K] extends void ? [] : [Events[K]]): void {
    this.handlers[event]?.forEach((h) => {
      try {
        h(args[0] as Events[K]);
      } catch (e) {
        console.error(`[hipcall-sdk] handler error for "${String(event)}"`, e);
      }
    });
  }
}

