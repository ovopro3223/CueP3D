/**
 * Generic LRU keyed cache. Kept free of VideoFrame/decoder knowledge so it
 * is trivial to unit-test; the eviction callback is where a player closes
 * whatever resource (VideoFrame.close(), etc.) the value holds.
 *
 * Overwriting an existing key with a *different* value runs the eviction
 * callback on the value being replaced (it is leaving the cache just as
 * surely as if it had been evicted by capacity) — otherwise a resource like
 * a VideoFrame or ImageBitmap set twice for the same key would leak.
 *
 * Entries whose key is currently "protected" (e.g. inside the active
 * prefetch window) are skipped when choosing an eviction candidate — per
 * the brief: "close intermediate frames unless they are within the
 * prefetch window." If every entry is protected the cache is allowed to
 * grow past `capacity` rather than evict a frame a caller just asked to
 * keep warm; this is a deliberate, bounded trade-off (the protected window
 * is always far smaller than the budget in practice).
 */

export interface LruCache<K, V> {
  get(key: K): V | undefined;
  peek(key: K): V | undefined;
  has(key: K): boolean;
  set(key: K, value: V): void;
  delete(key: K): boolean;
  clear(): void;
  readonly size: number;
  keys(): K[];
}

export function createLruCache<K, V>(
  capacity: number,
  onEvict: (key: K, value: V) => void,
  isProtected: (key: K) => boolean = () => false,
): LruCache<K, V> {
  if (capacity <= 0) throw new Error(`capacity must be positive, got ${capacity}`);
  const map = new Map<K, V>();

  function evictIfNeeded(): void {
    while (map.size > capacity) {
      let victim: K | undefined;
      for (const key of map.keys()) {
        if (!isProtected(key)) {
          victim = key;
          break;
        }
      }
      if (victim === undefined) return;
      const value = map.get(victim) as V;
      map.delete(victim);
      onEvict(victim, value);
    }
  }

  return {
    get(key) {
      if (!map.has(key)) return undefined;
      const value = map.get(key) as V;
      map.delete(key);
      map.set(key, value);
      return value;
    },
    peek(key) {
      return map.get(key);
    },
    has(key) {
      return map.has(key);
    },
    set(key, value) {
      if (map.has(key)) {
        const previous = map.get(key) as V;
        map.delete(key);
        if (previous !== value) onEvict(key, previous);
      }
      map.set(key, value);
      evictIfNeeded();
    },
    delete(key) {
      return map.delete(key);
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    },
    keys() {
      return [...map.keys()];
    },
  };
}
