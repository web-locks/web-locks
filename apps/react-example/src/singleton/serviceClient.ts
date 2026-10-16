import * as mockService from "./mockService.ts";

export type ClientSnapshot = { clientId: string; sessionToken: string; messageCount: number };

/**
 * A stand-in for a client that registers with a web service and must exist in
 * exactly one tab. `register()` talks to the (mock) service; `resume()` does not.
 */
export class ServiceClient {
  #state: ClientSnapshot;
  #listeners = new Set<() => void>();

  private constructor(state: ClientSnapshot) {
    this.#state = { ...state };
  }

  /** Registers a new client with the service. */
  static register(): ServiceClient {
    return new ServiceClient(mockService.register());
  }

  /** Continues a previous session without registering again. */
  static resume(snapshot: ClientSnapshot): ServiceClient {
    return new ServiceClient(snapshot);
  }

  snapshot(): ClientSnapshot {
    return { ...this.#state };
  }

  send(): void {
    this.#state = { ...this.#state, messageCount: this.#state.messageCount + 1 };
    for (const listener of [...this.#listeners]) listener();
  }

  /** Subscribes to state changes; returns the unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
