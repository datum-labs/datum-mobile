/** A non-2xx response from the control-plane API, with the K8s Status message when present. */
export class ApiError extends Error {
  readonly status: number;
  readonly reason?: string;
  readonly path: string;
  constructor(status: number, message: string, path: string, reason?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.reason = reason;
    this.path = path;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
}

/** milo denied the call because the user's email address isn't verified. */
export class EmailNotVerifiedError extends Error {
  constructor() {
    super('Verify your email address to continue.');
    this.name = 'EmailNotVerifiedError';
  }
}

/**
 * Pull `message`/`reason` from a K8s Status body (or `error` from a Loki-shaped
 * one), falling back to the HTTP status.
 */
export function parseK8sStatus(body: string, status: number): { message: string; reason?: string } {
  try {
    const json = JSON.parse(body) as { message?: string; reason?: string; error?: string };
    if (json.message) return { message: json.message, reason: json.reason };
    if (typeof json.error === 'string' && json.error) return { message: json.error };
  } catch {
    // not JSON
  }
  return { message: `Request failed (${status})` };
}

/** Short user-facing copy for any error the data layer throws. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return "You don't have access to this.";
    if (error.status === 404) return 'Not found.';
    if (error.status >= 500) return 'Datum Cloud is having trouble right now. Try again shortly.';
    return error.message;
  }
  if (error instanceof Error) {
    if (/network request failed/i.test(error.message)) return "You're offline, or Datum Cloud can't be reached.";
    return error.message;
  }
  return 'Something went wrong.';
}
