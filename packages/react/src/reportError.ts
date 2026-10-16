/**
 * Hand an error to the caller's `onError`, or else to the host's `reportError`
 * (falling back to `console.error`). Never throws. Internal; mirrors the
 * default in `@web-locks/core`, which the hooks bypass because they always pass
 * their own (ref-backed) `onError`.
 */
export function reportError(onError: ((error: unknown) => void) | undefined, error: unknown): void {
  try {
    if (onError) {
      onError(error);
      return;
    }
    const host = globalThis as { reportError?: (error: unknown) => void };
    if (typeof host.reportError === "function") host.reportError(error);
    else console.error(error);
  } catch {
    // A failing error handler must never break the hook.
  }
}
