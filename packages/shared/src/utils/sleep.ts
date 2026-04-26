export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function retry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; delayMs?: number; backoff?: number } = {},
): Promise<T> {
  const { retries = 3, delayMs = 250, backoff = 2 } = opts;
  let lastError: unknown;
  let wait = delayMs;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;
      await sleep(wait);
      wait *= backoff;
    }
  }
  throw lastError;
}
