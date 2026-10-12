import {
  orgScopedBase,
  projectScopedBase,
  resourcePath,
  scopedBase,
  userScopedBase,
} from '../scopes';

describe('scope builders', () => {
  test('match the portal base paths', () => {
    expect(userScopedBase('312345')).toBe(
      '/apis/iam.miloapis.com/v1alpha1/users/312345/control-plane'
    );
    expect(orgScopedBase('acme')).toBe(
      '/apis/resourcemanager.miloapis.com/v1alpha1/organizations/acme/control-plane'
    );
    expect(projectScopedBase('web-abc')).toBe(
      '/apis/resourcemanager.miloapis.com/v1alpha1/projects/web-abc/control-plane'
    );
    expect(scopedBase({ kind: 'project', project: 'p' })).toBe(projectScopedBase('p'));
  });

  test('encode path segments and refuse empty ids', () => {
    expect(userScopedBase('a/b')).toContain('/users/a%2Fb/');
    expect(() => projectScopedBase('')).toThrow(/project/);
  });

  test('build namespaced resource paths', () => {
    expect(
      resourcePath(
        { kind: 'project', project: 'p1' },
        {
          group: 'networking.datumapis.com',
          version: 'v1alpha',
          resource: 'httpproxies',
          namespace: 'default',
          name: 'my-alb',
        }
      )
    ).toBe(
      '/apis/resourcemanager.miloapis.com/v1alpha1/projects/p1/control-plane/apis/networking.datumapis.com/v1alpha/namespaces/default/httpproxies/my-alb'
    );
  });

  test('build cluster-scoped resource paths', () => {
    expect(
      resourcePath(
        { kind: 'user', sub: 'u1' },
        {
          group: 'resourcemanager.miloapis.com',
          version: 'v1alpha1',
          resource: 'organizationmemberships',
        }
      )
    ).toBe(
      '/apis/iam.miloapis.com/v1alpha1/users/u1/control-plane/apis/resourcemanager.miloapis.com/v1alpha1/organizationmemberships'
    );
  });
});
