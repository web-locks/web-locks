import { resolveLocks } from "./support.ts";
import type { LocksLike } from "./types.ts";

/** Snapshot of held and pending locks; empty when the API is unsupported. */
export async function queryLocks(locks?: LocksLike): Promise<LockManagerSnapshot> {
  const manager = resolveLocks(locks);
  if (!manager) return { held: [], pending: [] };
  return manager.query();
}
