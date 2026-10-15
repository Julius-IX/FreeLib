export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** An Error whose `name` can be matched on (the browser's own errors are told apart that way). */
export function namedError(name: string, message: string) {
  const e = new Error(message);
  e.name = name;
  return e;
}

/** Rejects if `p` hasn't settled after `ms`, so something that never answers can't freeze the UI. */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(namedError("TimeoutError", `${what} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
