import { describe, expect, it } from 'vitest';
import {
  guestMemberIntent,
  guestReadableRedirect,
  isGuestBrowsePath,
} from '../guestBrowsePaths';
import { isSignedOutSurface } from '../signedOutSurfaces';
import { resolveAuthRedirect } from '../authRedirect';

const id = '40000000-0000-4000-8000-000000000001';

describe('minimal guest routes', () => {
  it('allows only the dedicated browse and UUID detail routes', () => {
    for (const path of ['/browse', '/browse/', `/browse/post/${id}`]) {
      expect(isGuestBrowsePath(path)).toBe(true);
    }
    for (const path of [
      '/browse/create',
      '/browse/post/private',
      `/browse/post/${id}/edit`,
      '/browse//post/x',
      '/post/x',
      '/chat/x',
    ]) {
      expect(isGuestBrowsePath(path)).toBe(false);
    }
  });

  it('never opens member routes or unknown browse children as signed-out surfaces', () => {
    expect(isSignedOutSurface(['browse'], '/browse')).toBe(true);
    expect(isSignedOutSurface(['browse', 'post', '[id]'], `/browse/post/${id}`)).toBe(true);
    expect(isSignedOutSurface(['browse', 'create'], '/browse/create')).toBe(false);
    for (const head of ['post', 'chat', 'create', '(tabs)']) {
      expect(isSignedOutSurface([head], `/${head}/${id}`)).toBe(false);
    }
  });

  it('remaps guest-readable member deep links instead of a sign-up wall', () => {
    const base = {
      navigationReady: true,
      isLoading: false,
      isAuthenticated: false,
      onboardingState: null,
      basicInfoSkipped: null,
    };
    expect(resolveAuthRedirect({ ...base, segments: ['browse'], pathname: '/browse' }).kind).toBe(
      'stay',
    );
    expect(
      resolveAuthRedirect({
        ...base,
        segments: ['post', '[id]'],
        pathname: `/post/${id}`,
      }),
    ).toEqual({ kind: 'guest', href: `/browse/post/${id}` });
    expect(
      resolveAuthRedirect({ ...base, segments: ['(tabs)'], pathname: '/' }),
    ).toEqual({ kind: 'guest', href: '/browse' });
    // Map / other profiles still need anon RPCs — remember path, no dead-end error screen.
    expect(
      resolveAuthRedirect({
        ...base,
        segments: ['(tabs)', 'donations', 'marketplace', 'map'],
        pathname: '/donations/marketplace/map',
      }),
    ).toEqual({ kind: 'welcome', rememberPath: '/donations/marketplace/map' });
    expect(
      resolveAuthRedirect({
        ...base,
        segments: ['user', '[handle]'],
        pathname: '/user/alice',
      }),
    ).toEqual({ kind: 'welcome', rememberPath: '/user/alice' });
  });

  it('maps only UUID member posts and the home feed to guest routes', () => {
    expect(guestReadableRedirect(`/post/${id}`)).toBe(`/browse/post/${id}`);
    expect(guestReadableRedirect('/post/42')).toBeNull();
    expect(guestReadableRedirect('/')).toBe('/browse');
    expect(guestReadableRedirect('/user/alice')).toBeNull();
    expect(guestReadableRedirect('/donations/marketplace/map')).toBeNull();
  });

  it('restores only a valid member post after guest CTA sign-in', () => {
    expect(guestMemberIntent(id)).toBe(`/post/${id}`);
    expect(guestMemberIntent()).toBeNull();
    expect(guestMemberIntent('../chat/private')).toBeNull();
  });
});
