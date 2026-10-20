/**
 * "Is the grid being scrolled right now?" Cover reads and category queries are deferred while it is,
 * so a scroll only pays for mounting cheap DOM and the heavy work lands once it settles.
 */
const IDLE_MS = 120;

let scrolling = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const waiters = new Set<() => void>();

/** Call from every scroll event. */
export function markScrolling() {
  scrolling = true;
  clearTimeout(timer);
  timer = setTimeout(() => {
    scrolling = false;
    const run = [...waiters];
    waiters.clear();
    run.forEach((w) => w());
  }, IDLE_MS);
}

export const isScrolling = () => scrolling;

/** Runs `cb` once scrolling has stopped (a Set, so registering the same function twice is fine). */
export const onScrollIdle = (cb: () => void) => {
  waiters.add(cb);
};
