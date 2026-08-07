import { ApiError } from '@workspace/api-client-react';

/**
 * Convert any error thrown by an API mutation into a short, friendly
 * message safe to show in an alert. `action` describes what failed,
 * e.g. "save the repair".
 */
export function friendlyErrorMessage(err: unknown, action: string): string {
  // Network failure (server unreachable, no connection) — fetch rejects
  // with a TypeError before any HTTP response exists.
  if (err instanceof TypeError || (err instanceof Error && /network request failed|failed to fetch/i.test(err.message))) {
    return `Couldn't ${action} — the server can't be reached. Check your connection and try again. Your entries are still here.`;
  }

  if (err instanceof ApiError) {
    if (err.status === 401) {
      return `Your session has expired. Please sign in again, then ${action}.`;
    }
    if (err.status === 403) {
      return `You don't have permission to ${action}.`;
    }
    if (err.status >= 500) {
      return `Couldn't ${action} — something went wrong on the server. Please try again in a moment. Your entries are still here.`;
    }
    // 4xx validation-style errors: surface the server's message if it has one.
    const detail =
      (err.data && typeof err.data === 'object' && typeof (err.data as any).message === 'string')
        ? (err.data as any).message
        : null;
    if (detail) {
      return `Couldn't ${action}: ${detail}`;
    }
  }

  return `Couldn't ${action}. Please try again. Your entries are still here.`;
}

/**
 * Wrap a mutation error so callers can show `error.message` directly.
 * The original error is preserved as `cause` for debugging.
 */
export function toFriendlyError(err: unknown, action: string): Error {
  const friendly = new Error(friendlyErrorMessage(err, action));
  (friendly as any).cause = err;
  return friendly;
}
