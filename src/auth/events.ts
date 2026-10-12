type AuthEvent = { type: 'emailNotVerified' } | { type: 'authRequired'; message?: string };

const listeners = new Set<(event: AuthEvent) => void>();

/** Tiny bus so the API layer can tell the auth UI about denials without importing React. */
export const authEvents = {
  emit(event: AuthEvent) {
    for (const listener of listeners) listener(event);
  },
  subscribe(listener: (event: AuthEvent) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
