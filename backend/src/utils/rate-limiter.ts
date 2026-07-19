/**
 * Promise-serializing interval limiter: each caller's promise resolves at
 * least `minIntervalMs` after the previous caller's slot, regardless of how
 * many callers arrive at once. Await the returned throttle() before every
 * outbound request to cap throughput at 1000/minIntervalMs req/s.
 */
export function createRateLimiter(minIntervalMs: number): () => Promise<void> {
  let nextSlot = 0;
  return function throttle(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, nextSlot);
    nextSlot = slot + minIntervalMs;
    const wait = slot - now;
    if (wait <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, wait));
  };
}
