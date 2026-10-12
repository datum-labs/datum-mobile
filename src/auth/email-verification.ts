/**
 * milo's EmailNotVerifiedCause, emitted by the EmailVerificationEnforcement
 * admission plugin on a 403. Ported from cloud-portal
 * `app/features/account/email-verification/email-verification-error.ts`.
 */
export const EMAIL_NOT_VERIFIED_CAUSE = 'EmailNotVerified';

/**
 * Does this raw 403 body carry the verification cause? Reads the K8s Status
 * `details.causes[].type` (the typed channel) rather than matching the
 * message, which would break the moment the wording changes.
 */
export function isEmailNotVerifiedDenial(body: string): boolean {
  try {
    const status = JSON.parse(body) as {
      details?: { causes?: Array<{ type?: string }> };
    };
    return (status.details?.causes ?? []).some((c) => c.type === EMAIL_NOT_VERIFIED_CAUSE);
  } catch {
    return false;
  }
}
