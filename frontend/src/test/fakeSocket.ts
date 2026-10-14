// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (...args: any[]) => void;

export class FakeSocket {
  handlers = new Map<string, Set<Handler>>();
  emitted: Array<{ event: string; args: unknown[] }> = [];
  disconnected = false;

  on(event: string, handler: Handler): this {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return this;
  }

  off(event: string, handler: Handler): this {
    this.handlers.get(event)?.delete(handler);
    return this;
  }

  emit(event: string, ...args: unknown[]): this {
    this.emitted.push({ event, args });
    const ack = args[args.length - 1];
    if (event === "ticket:join" && typeof ack === "function") (ack as (ok: boolean) => void)(true);
    return this;
  }

  connected = false;

  connect(): this {
    this.connected = true;
    return this;
  }

  disconnect(): this {
    this.disconnected = true;
    return this;
  }

  serverEmit(event: string, payload?: unknown): void {
    this.handlers.get(event)?.forEach((handler) => handler(payload));
  }
}
