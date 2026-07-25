export type Unsubscribe = () => void;

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

  protected emit(): void {
    this.#version += 1;

    for (const listener of this.#listeners) {
      listener();
    }
  }
}
