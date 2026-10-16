export { isSupported } from "./support.ts";
export { queryLocks } from "./query.ts";
export { acquireLock } from "./lock.ts";
export type { AcquireOptions, LockHandle } from "./lock.ts";
export { createLockStatus } from "./status.ts";
export type { LockStatus, LockStatusOptions } from "./status.ts";
export { createLeader, windowPageEvents } from "./leader.ts";
export type { Leader, LeaderOptions, PageEvents } from "./leader.ts";
export type { LeadershipState, LocksLike, LockState, Store } from "./types.ts";
