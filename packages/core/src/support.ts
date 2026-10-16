import type { LocksLike } from "./types.ts";

/**
 * Resolve the lock manager to use: the explicit argument, else
 * `navigator.locks`. `navigator` is read lazily so importing is side-effect free.
 */
export function resolveLocks(locks?: LocksLike): LocksLike | undefined {
  if (locks) return locks;
  return (globalThis as { navigator?: { locks?: LocksLike } }).navigator?.locks ?? undefined;
}

/** Whether the Web Locks API is available (or an explicit manager was given). */
export function isSupported(locks?: LocksLike): boolean {
  return resolveLocks(locks) !== undefined;
}
