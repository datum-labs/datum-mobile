import { sizedAvatarUrl, toUserProfile } from '../service';

describe('toUserProfile', () => {
  it('joins the name and resizes the Google avatar', () => {
    expect(
      toUserProfile({
        metadata: { name: '123' },
        spec: { email: 'a@b.c', givenName: 'Matt', familyName: 'Jenkinson' },
        status: { avatarUrl: 'https://lh3.googleusercontent.com/a/xyz=s96-c' },
      })
    ).toEqual({
      sub: '123',
      email: 'a@b.c',
      fullName: 'Matt Jenkinson',
      avatarUrl: 'https://lh3.googleusercontent.com/a/xyz=s192-c',
    });
  });

  it('leaves the name unset when neither part is present', () => {
    expect(toUserProfile({ spec: { givenName: ' ' } }).fullName).toBeUndefined();
  });
});

describe('sizedAvatarUrl', () => {
  it('passes through URLs without a size suffix', () => {
    expect(sizedAvatarUrl('https://avatars.githubusercontent.com/u/1?v=4')).toBe(
      'https://avatars.githubusercontent.com/u/1?v=4'
    );
  });
});
