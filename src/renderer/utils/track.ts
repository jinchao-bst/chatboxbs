// Analytics disabled for internal debug builds.
// Keep the function signature to avoid runtime errors, but do nothing.
export function trackEvent(_event: string, _props: Record<string, unknown> = {}) {
  // no-op
}
