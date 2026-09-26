/** Cancel the caller's wait even when a storage/parser API cannot cancel its own I/O. */
export function waitForWork<T>(
  work: Promise<T>,
  signal?: AbortSignal,
  disposeLateResult?: (value: T) => void | Promise<void>,
): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    let cancelled = false;
    const abort = () => {
      cancelled = true;
      signal.removeEventListener('abort', abort);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    work.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        if (cancelled)
          void Promise.resolve()
            .then(() => disposeLateResult?.(value))
            .catch(() => undefined);
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        if (!cancelled) reject(error);
      },
    );
  });
}

/** A task boundary allows input, paint, and AbortController events to run. */
export async function yieldToReader(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await waitForWork(new Promise<void>((resolve) => setTimeout(resolve, 0)), signal);
  signal?.throwIfAborted();
}
