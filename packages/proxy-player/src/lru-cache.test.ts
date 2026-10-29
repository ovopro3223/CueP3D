import { describe, expect, it, vi } from 'vitest';
import { createLruCache } from './lru-cache.js';

describe('createLruCache', () => {
  it('evicts the least-recently-used entry when over capacity', () => {
    const evicted: number[] = [];
    const cache = createLruCache<number, string>(2, (key) => evicted.push(key));
    cache.set(1, 'a');
    cache.set(2, 'b');
    cache.set(3, 'c');
    expect(evicted).toEqual([1]);
    expect(cache.has(1)).toBe(false);
    expect(cache.has(2)).toBe(true);
    expect(cache.has(3)).toBe(true);
  });

  it('get() refreshes recency, protecting a just-read entry from eviction', () => {
    const evicted: number[] = [];
    const cache = createLruCache<number, string>(2, (key) => evicted.push(key));
    cache.set(1, 'a');
    cache.set(2, 'b');
    cache.get(1); // 1 is now more recently used than 2
    cache.set(3, 'c');
    expect(evicted).toEqual([2]);
    expect(cache.has(1)).toBe(true);
    expect(cache.has(3)).toBe(true);
  });

  it('peek() does not affect recency', () => {
    const evicted: number[] = [];
    const cache = createLruCache<number, string>(2, (key) => evicted.push(key));
    cache.set(1, 'a');
    cache.set(2, 'b');
    cache.peek(1);
    cache.set(3, 'c');
    expect(evicted).toEqual([1]);
  });

  it('calls the eviction callback with the evicted value so close() can run', () => {
    const closed: string[] = [];
    const cache = createLruCache<number, { close(): void; tag: string }>(1, (_key, value) =>
      value.close(),
    );
    const frameA = { tag: 'a', close: () => closed.push('a') };
    const frameB = { tag: 'b', close: () => closed.push('b') };
    cache.set(1, frameA);
    cache.set(2, frameB);
    expect(closed).toEqual(['a']);
  });

  it('overflows past capacity only when every entry, including the newest, is protected', () => {
    const evicted: number[] = [];
    const protectedKeys = new Set([1, 2]);
    const cache = createLruCache<number, string>(
      1,
      (key) => evicted.push(key),
      (key) => protectedKeys.has(key),
    );
    cache.set(1, 'a');
    cache.set(2, 'b'); // no unprotected candidate exists; must overflow rather than evict a pinned frame
    expect(evicted).toEqual([]);
    expect(cache.size).toBe(2);
    expect(cache.has(1)).toBe(true);
    expect(cache.has(2)).toBe(true);
  });

  it('resumes evicting the overflow once keys are no longer protected', () => {
    const evicted: number[] = [];
    const protectedKeys = new Set([1, 2]);
    const cache = createLruCache<number, string>(
      1,
      (key) => evicted.push(key),
      (key) => protectedKeys.has(key),
    );
    cache.set(1, 'a');
    cache.set(2, 'b');
    protectedKeys.clear();
    cache.set(3, 'c');
    expect(evicted).toEqual([1, 2]);
    expect(cache.keys()).toEqual([3]);
  });

  it('closes the old value when a key is overwritten with a different one', () => {
    const closed: string[] = [];
    const cache = createLruCache<number, { close(): void; tag: string }>(2, (_key, value) =>
      value.close(),
    );
    const frameA1 = { tag: 'a1', close: () => closed.push('a1') };
    const frameA2 = { tag: 'a2', close: () => closed.push('a2') };
    cache.set(1, frameA1);
    cache.set(1, frameA2); // same key, new value — a1 must not leak
    expect(closed).toEqual(['a1']);
    expect(cache.peek(1)).toBe(frameA2);
    expect(cache.size).toBe(1);
  });

  it('setting the same key to the same value does not evict it', () => {
    const evicted: number[] = [];
    const cache = createLruCache<number, string>(2, (key) => evicted.push(key));
    cache.set(1, 'a');
    cache.set(1, 'a');
    expect(evicted).toEqual([]);
  });

  it('rejects a non-positive capacity', () => {
    expect(() => createLruCache(0, vi.fn())).toThrow();
  });
});
