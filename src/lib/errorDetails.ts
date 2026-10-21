// What the "Something went wrong" panel copies and logs about an error
// the interface could not draw past (src/components/ErrorBoundary.tsx).

/** The longest details the panel copies; the app log cuts its own lines. */
export const ERROR_DETAILS_MAX = 8_000;

/** The error, where in the interface it happened, and what ran it, as
 * plain text for a bug report. Never more than ERROR_DETAILS_MAX. */
export function errorDetails(
  error: unknown,
  componentStack: string | null | undefined,
  context: { at?: Date; userAgent?: string } = {},
): string {
  const e = error instanceof Error ? error : null;
  const headline = e ? `${e.name}: ${e.message}` : `Thrown: ${String(error)}`;
  const parts = [
    headline,
    `When: ${(context.at ?? new Date()).toISOString()}`,
    ...(context.userAgent ? [`Running: ${context.userAgent}`] : []),
    ...(e?.stack ? ["", "Stack:", e.stack] : []),
    ...(componentStack?.trim() ? ["", "Where in the interface:", componentStack.trim()] : []),
  ];
  return parts.join("\n").slice(0, ERROR_DETAILS_MAX);
}
