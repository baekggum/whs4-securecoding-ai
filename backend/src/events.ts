import { EventEmitter } from "events";

interface DomainEvents {
  "user:dormant": { userId: string };
}

class TypedDomainEmitter extends EventEmitter {
  emitEvent<K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]): void {
    this.emit(event, payload);
  }

  onEvent<K extends keyof DomainEvents>(event: K, listener: (payload: DomainEvents[K]) => void): void {
    this.on(event, listener);
  }
}

// Single-process domain event bus decoupling the REST service layer from
// the realtime transport layer (docs/architecture.md §5 "WebSocket 연결의
// 즉시 무효화 보강"). If this app ever scales to multiple instances, this
// needs to be swapped for Redis Pub/Sub so the event reaches every
// instance's Socket.IO server, not just the one that handled the report.
export const domainEvents = new TypedDomainEmitter();
