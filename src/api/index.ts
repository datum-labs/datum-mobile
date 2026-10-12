import { authEvents } from '@/auth/events';
import { session } from '@/auth/instance';
import { env } from '@/config/env';

import { createApiClient } from './client';

export const api = createApiClient({
  baseUrl: env.apiUrl,
  tokens: session,
  onEmailNotVerified: () => authEvents.emit({ type: 'emailNotVerified' }),
});

export { ApiError, EmailNotVerifiedError, describeError } from './errors';
export * from './scopes';
