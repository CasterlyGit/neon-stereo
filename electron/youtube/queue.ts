import type { QueueItem } from './preferences.js';

export type QueueDeps = {
  initial?: QueueItem[];
  onChange?: (items: QueueItem[]) => void;
  maxLen?: number;
};

export type Queue = {
  list(): QueueItem[];
  add(item: QueueItem): void;
  current(): QueueItem | null;
  next(): QueueItem | null;
  prev(): QueueItem | null;
  remove(videoId: string): void;
  cursor(): number;
};

const DEFAULT_MAX = 20;

export function createQueue(deps: QueueDeps = {}): Queue {
  const max = deps.maxLen ?? DEFAULT_MAX;
  let items: QueueItem[] = (deps.initial ?? []).slice(0, max);
  let cursor = items.length === 0 ? -1 : 0;

  const notify = (): void => {
    deps.onChange?.(items.slice());
  };

  function add(item: QueueItem): void {
    // Move-to-front if already present.
    const existingIdx = items.findIndex((q) => q.videoId === item.videoId);
    if (existingIdx >= 0) items.splice(existingIdx, 1);
    items.unshift(item);
    if (items.length > max) items = items.slice(0, max);
    cursor = 0;
    notify();
  }

  function current(): QueueItem | null {
    if (cursor < 0 || cursor >= items.length) return null;
    return items[cursor] ?? null;
  }

  function next(): QueueItem | null {
    if (items.length === 0) return null;
    cursor = Math.min(items.length - 1, cursor + 1);
    return current();
  }

  function prev(): QueueItem | null {
    if (items.length === 0) return null;
    cursor = Math.max(0, cursor - 1);
    return current();
  }

  function remove(videoId: string): void {
    const idx = items.findIndex((q) => q.videoId === videoId);
    if (idx < 0) return;
    items.splice(idx, 1);
    if (items.length === 0) {
      cursor = -1;
    } else if (cursor >= items.length) {
      cursor = items.length - 1;
    }
    notify();
  }

  return {
    list: () => items.slice(),
    add,
    current,
    next,
    prev,
    remove,
    cursor: () => cursor,
  };
}
