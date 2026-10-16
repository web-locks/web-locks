/**
 * Report an error the library cannot throw to its caller (internal; not exported).
 *
 * Calls `onError` when given; otherwise hands the error to the host's
 * `reportError` (browsers log it as an uncaught error), falling back to
 * `console.error`. Never throws, even when `onError` does.
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
    // A failing error handler must never break the library.
  }
}
