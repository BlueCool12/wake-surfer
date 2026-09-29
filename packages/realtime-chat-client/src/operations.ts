import { abortError, assertActive, clientError } from "./errors.js";
import { RealtimeChatClientError } from "./realtime-chat-client-error.js";
export function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
    throw new TypeError(name + "는 1부터 2,147,483,647 사이의 정수여야 합니다.");
  }
  return value;
}

export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export async function withTimeout<T>(
  parent: AbortSignal,
  milliseconds: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  assertActive(parent);
  const controller = new AbortController();
  const signal = AbortSignal.any([parent, controller.signal]);
  const timer = setTimeout(
    () => controller.abort(new RealtimeChatClientError("timeout")),
    milliseconds,
  );
  try {
    const result = await abortable(run(signal), signal);
    assertActive(signal);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  assertActive(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function retry<T>(
  run: () => Promise<T>,
  signal: AbortSignal,
  policy: { maxAttempts: number; baseDelayMilliseconds: number; maxDelayMilliseconds: number },
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    assertActive(signal);
    try {
      return await run();
    } catch (error) {
      assertActive(signal);
      const failure = clientError(error);
      if (!failure.retryable || attempt >= policy.maxAttempts) throw failure;
      await delay(
        Math.min(policy.baseDelayMilliseconds * 2 ** (attempt - 1), policy.maxDelayMilliseconds),
        signal,
      );
    }
  }
}
