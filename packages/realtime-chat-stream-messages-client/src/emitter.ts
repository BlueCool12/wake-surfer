export type Unsubscribe = () => void;

let batchDepth = 0;
let flushing = false;
const pendingNotifications = new Set<() => void>();

/** 모든 원본과 버전을 먼저 바꾼 뒤 알린다. 동기 작업만 전달하며 중첩할 수 있다. */
export function batchChanges(change: () => void): void {
  batchDepth += 1;
  try {
    change();
  } finally {
    batchDepth -= 1;
    flushNotifications();
  }
}

function flushNotifications(): void {
  if (batchDepth > 0 || flushing) return;
  flushing = true;
  try {
    while (pendingNotifications.size > 0) {
      const notifications = [...pendingNotifications];
      pendingNotifications.clear();
      for (const notify of notifications) notify();
    }
  } finally {
    flushing = false;
  }
}

export class Emitter {
  #version = 0;
  readonly #listeners = new Set<() => void>();

  readonly subscribe = (onChange: () => void): Unsubscribe => {
    this.#listeners.add(onChange);
    return () => {
      this.#listeners.delete(onChange);
    };
  };

  readonly getVersion = (): number => this.#version;

  readonly #notify = (): void => {
    for (const listener of this.#listeners) listener();
  };

  protected emit(): void {
    this.#version += 1;
    pendingNotifications.add(this.#notify);
    flushNotifications();
  }
}
