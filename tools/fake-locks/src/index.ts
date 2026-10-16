type Mode = "exclusive" | "shared";

interface Entry {
  name: string;
  mode: Mode;
  clientId: string;
  callback: (lock: Lock | null) => unknown;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
  stolen: boolean;
}

const abortError = () => new DOMException("The lock request was aborted.", "AbortError");

/**
 * In-memory stand-in for `navigator.locks` with the core Web Locks semantics:
 * FIFO queue per name, shared/exclusive modes, ifAvailable, steal and signal.
 */
export class FakeLockManager implements Pick<LockManager, "request" | "query"> {
  #held = new Map<string, Entry[]>();
  #queue = new Map<string, Entry[]>();
  #clientId = "fake-client";

  request<T>(name: string, callback: LockGrantedCallback<T>): Promise<Awaited<T>>;
  request<T>(
    name: string,
    options: LockOptions,
    callback: LockGrantedCallback<T>,
  ): Promise<Awaited<T>>;
  request(
    name: string,
    a: LockOptions | LockGrantedCallback<unknown>,
    b?: LockGrantedCallback<unknown>,
  ): Promise<unknown> {
    const options: LockOptions = typeof a === "function" ? {} : a;
    const callback = (typeof a === "function" ? a : b) as LockGrantedCallback<unknown>;
    const mode: Mode = options.mode ?? "exclusive";

    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(abortError());
        return;
      }
      const entry: Entry = {
        name,
        mode,
        clientId: this.#clientId,
        callback: callback as Entry["callback"],
        resolve,
        reject,
        signal: options.signal,
        stolen: false,
      };
      const held = this.#heldFor(name);
      const queue = this.#queueFor(name);

      if (options.steal) {
        for (const h of held.splice(0)) {
          h.stolen = true;
          h.reject(abortError());
        }
        queue.unshift(entry);
      } else if (options.ifAvailable) {
        if (queue.length > 0 || !this.#canGrant(entry, held)) {
          queueMicrotask(() => this.#run(entry, null));
          return;
        }
        queue.push(entry);
      } else {
        queue.push(entry);
      }

      if (entry.signal) {
        entry.onAbort = () => {
          const q = this.#queueFor(name);
          const i = q.indexOf(entry);
          if (i === -1) return;
          q.splice(i, 1);
          entry.reject(abortError());
          this.#process(name);
        };
        entry.signal.addEventListener("abort", entry.onAbort, { once: true });
      }
      this.#process(name);
    });
  }

  async query(): Promise<LockManagerSnapshot> {
    const info = (e: Entry): LockInfo => ({ name: e.name, mode: e.mode, clientId: e.clientId });
    return {
      held: [...this.#held.values()].flat().map(info),
      pending: [...this.#queue.values()].flat().map(info),
    };
  }

  /** Test helper: names of locks currently held. */
  heldNames(): string[] {
    return [...this.#held.entries()].filter(([, h]) => h.length > 0).map(([n]) => n);
  }

  #heldFor(name: string): Entry[] {
    let h = this.#held.get(name);
    if (!h) this.#held.set(name, (h = []));
    return h;
  }

  #queueFor(name: string): Entry[] {
    let q = this.#queue.get(name);
    if (!q) this.#queue.set(name, (q = []));
    return q;
  }

  #canGrant(entry: Entry, held: Entry[]): boolean {
    if (held.length === 0) return true;
    return entry.mode === "shared" && held.every((h) => h.mode === "shared");
  }

  #process(name: string): void {
    const held = this.#heldFor(name);
    const queue = this.#queueFor(name);
    while (queue.length > 0 && this.#canGrant(queue[0]!, held)) {
      const entry = queue.shift()!;
      if (entry.onAbort) entry.signal?.removeEventListener("abort", entry.onAbort);
      held.push(entry);
      const lock: Lock = { name: entry.name, mode: entry.mode };
      queueMicrotask(() => this.#run(entry, lock));
    }
    if (held.length === 0 && queue.length === 0) {
      this.#held.delete(name);
      this.#queue.delete(name);
    }
  }

  async #run(entry: Entry, lock: Lock | null): Promise<void> {
    let ok = true;
    let value: unknown;
    try {
      value = await entry.callback(lock);
    } catch (error) {
      ok = false;
      value = error;
    }
    if (lock && !entry.stolen) {
      const held = this.#heldFor(entry.name);
      const i = held.indexOf(entry);
      if (i !== -1) held.splice(i, 1);
      this.#process(entry.name);
    }
    if (entry.stolen) return; // request promise already rejected
    if (ok) entry.resolve(value);
    else entry.reject(value);
  }
}
