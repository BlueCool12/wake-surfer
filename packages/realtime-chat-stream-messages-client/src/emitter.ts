export type Unsubscribe = () => void;

let batchDepth = 0;
let flushing = false;
let updatingModels = false;
const pendingModelUpdates = new Set<() => void>();
const pendingNotifications = new Set<() => void>();

/** 원본과 파생 범위의 버전을 모두 갱신한 뒤 외부 구독자에게 알린다. */
export function batchChanges(change: () => void): void {
  batchDepth += 1;
  try {
    change();
  } finally {
    batchDepth -= 1;
    flushModelUpdates();
    flushNotifications();
  }
}

/** 같은 파생 계산은 동기 배치당 한 번, 외부 알림보다 먼저 수행한다. */
export function scheduleModelUpdate(update: () => void): void {
  pendingModelUpdates.add(update);
  flushModelUpdates();
  flushNotifications();
}

function flushModelUpdates(): void {
  if (batchDepth > 0 || updatingModels) return;
  updatingModels = true;
  try {
    while (pendingModelUpdates.size > 0) {
      const updates = [...pendingModelUpdates];
      pendingModelUpdates.clear();
      batchDepth += 1;
      try {
        for (const update of updates) update();
      } finally {
        batchDepth -= 1;
      }
    }
  } finally {
    updatingModels = false;
  }
}

function flushNotifications(): void {
  if (batchDepth > 0 || updatingModels || flushing) return;
  flushing = true;
  const errors: unknown[] = [];
  try {
    while (pendingNotifications.size > 0) {
      const notifications = [...pendingNotifications];
      pendingNotifications.clear();
      for (const notify of notifications) {
        try {
          notify();
        } catch (error) {
          errors.push(error);
        }
      }
    }
  } finally {
    flushing = false;
  }
  if (errors.length > 0) throw new AggregateError(errors, "변경 구독자 실행 실패");
}

export class Emitter {
  #version = 0;
  readonly #listeners = new Set<() => void>();
  readonly #observers = new Set<() => void>();

  readonly subscribe = (onChange: () => void): Unsubscribe => {
    this.#listeners.add(onChange);
    return () => {
      this.#listeners.delete(onChange);
    };
  };

  /** 저장소 내부의 파생 범위를 동기 갱신한다. 화면 구독에는 subscribe를 쓴다. */
  readonly observeChanges = (onChange: () => void): Unsubscribe => {
    this.#observers.add(onChange);
    return () => {
      this.#observers.delete(onChange);
    };
  };

  readonly getVersion = (): number => this.#version;

  readonly #notify = (): void => {
    const errors: unknown[] = [];
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, "변경 구독자 실행 실패");
  };

  clearSubscriptions(): void {
    this.#listeners.clear();
    this.#observers.clear();
    pendingNotifications.delete(this.#notify);
  }

  protected emit(): void {
    batchChanges(() => {
      this.#version += 1;
      pendingNotifications.add(this.#notify);
      for (const observer of this.#observers) observer();
    });
  }
}

export interface ReadScope<T> {
  readonly value: T;
  readonly subscribe: (onChange: () => void) => Unsubscribe;
  readonly getVersion: () => number;
}

export class ModelReadScope<T> extends Emitter implements ReadScope<T> {
  private readonly read: () => T;
  constructor(read: () => T) {
    super();
    this.read = read;
  }
  get value(): T {
    return this.read();
  }
  changed(): void {
    this.emit();
  }
}
