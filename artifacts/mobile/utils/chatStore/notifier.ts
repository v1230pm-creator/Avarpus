import type { StoreChange, StoreListener } from './types';

/**
 * Coalesces store writes into change events. Inside `batch()` every touch is
 * accumulated and delivered once at the end, so a sync page that upserts 200
 * messages triggers one re-render instead of 200.
 */
export class ChangeNotifier {
  private listeners = new Set<StoreListener>();
  private depth = 0;
  private pending: StoreChange | null = null;

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  touchRooms(): void {
    this.touch({ rooms: true, roomIds: new Set(), outbox: false });
  }

  touchMessages(roomIds: Iterable<string>): void {
    // Any timeline change can move a room's preview/unread count too.
    this.touch({ rooms: true, roomIds: new Set(roomIds), outbox: false });
  }

  touchOutbox(roomId?: string): void {
    this.touch({ rooms: true, roomIds: new Set(roomId ? [roomId] : []), outbox: true });
  }

  async batch<T>(fn: () => Promise<T>): Promise<T> {
    this.depth += 1;
    try {
      return await fn();
    } finally {
      this.depth -= 1;
      if (this.depth === 0) this.flush();
    }
  }

  private touch(change: StoreChange): void {
    if (!this.pending) {
      this.pending = { rooms: false, roomIds: new Set(), outbox: false };
    }
    this.pending.rooms = this.pending.rooms || change.rooms;
    this.pending.outbox = this.pending.outbox || change.outbox;
    for (const id of change.roomIds) this.pending.roomIds.add(id);
    if (this.depth === 0) this.flush();
  }

  private flush(): void {
    const change = this.pending;
    this.pending = null;
    if (!change) return;
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch {
        // A broken subscriber must not stop the others from updating.
      }
    }
  }
}
