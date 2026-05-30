type Subscriber = (event: string, data: unknown) => void;

/**
 * イベント ID ごとに SSE 購読者を管理するハブ。
 * 状態変更時に該当イベントの全購読者へ push する。
 */
class SseHub {
  private channels = new Map<string, Set<Subscriber>>();

  subscribe(eventId: string, sub: Subscriber): () => void {
    let set = this.channels.get(eventId);
    if (!set) {
      set = new Set();
      this.channels.set(eventId, set);
    }
    set.add(sub);
    return () => {
      set?.delete(sub);
      if (set && set.size === 0) this.channels.delete(eventId);
    };
  }

  broadcast(eventId: string, event: string, data: unknown): void {
    const set = this.channels.get(eventId);
    if (!set) return;
    for (const sub of set) sub(event, data);
  }
}

export const sseHub = new SseHub();
