import { isEmailNotVerifiedDenial } from '../email-verification';

describe('isEmailNotVerifiedDenial', () => {
  test('matches the typed cause only', () => {
    expect(
      isEmailNotVerifiedDenial(JSON.stringify({ details: { causes: [{ type: 'EmailNotVerified' }] } }))
    ).toBe(true);
    expect(isEmailNotVerifiedDenial(JSON.stringify({ message: 'EmailNotVerified' }))).toBe(false);
    expect(isEmailNotVerifiedDenial('not json')).toBe(false);
  });
});
