import { reportError } from "./errors.ts";
import { resolveLocks } from "./support.ts";
import type { LocksLike } from "./types.ts";

export type LockHandle = {
  readonly name: string;
  /** Idempotent; resolves once the underlying request has finished. */
  release: () => Promise<void>;
};

export type AcquireOptions = {
  mode?: LockMode;
  ifAvailable?: boolean;
  steal?: boolean;
  signal?: AbortSignal;
  locks?: LocksLike;
  /** Called if the lock is taken from this holder (e.g. stolen). */
  onLost?: () => void;
  /**
   * Receives errors thrown by callbacks such as `onLost`. Defaults to the
   * global `reportError` (or `console.error`).
   */
  onError?: (error: unknown) => void;
};

/**
 * Acquire a named lock. Resolves a handle once granted, or `null` when the API
 * is unsupported or `ifAvailable` finds the lock taken. Rejects with
 * `signal.reason` if `signal` aborts while queued (an `AbortError`
 * `DOMException` unless a reason was passed to `abort()`), and with the lock
 * manager's error for invalid requests.
 */
export function acquireLock(
  name: string,
  options: AcquireOptions = {},
): Promise<LockHandle | null> {
  const manager = resolveLocks(options.locks);
  if (!manager) return Promise.resolve(null);
  const { mode, ifAvailable, steal, signal, onLost, onError } = options;

  return new Promise<LockHandle | null>((resolve, reject) => {
    let granted = false;
    let freeLock!: () => void;
    const held = new Promise<void>((r) => {
      freeLock = r;
    });

    const request = manager.request(name, { mode, ifAvailable, steal, signal }, async (lock) => {
      if (!lock) {
        resolve(null);
        return;
      }
      granted = true;
      resolve(handle);
      await held;
    });

    const finished = request.then(
      () => {},
      (err: unknown) => {
        if (!granted) {
          reject(err);
          return;
        }
        // Granted, then the request failed: the lock was taken from us (steal).
        try {
          onLost?.();
        } catch (error) {
          reportError(onError, error);
        }
      },
    );

    const handle: LockHandle = {
      name,
      release: () => {
        freeLock();
        return finished;
      },
    };
  });
}
