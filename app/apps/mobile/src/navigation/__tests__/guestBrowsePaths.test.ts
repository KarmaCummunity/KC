import { describe, expect, it } from 'vitest';
import {
  guestMemberIntent,
  guestReadableRedirect,
  isGuestBrowsePath,
} from '../guestBrowsePaths';
import { isSignedOutSurface } from '../signedOutSurfaces';
import { resolveAuthRedirect } from '../authRedirect';

const id = '40000000-0000-4000-8000-000000000001';

describe('guest browse routes', () => {
  it('allows browse feed, post, map and user profile paths', () => {
    for (const path of [
      '/browse',
      '/browse/',
      `/browse/post/${id}`,
      '/browse/map',
      '/browse/user/alice',
    ]) {
      expect(isGuestBrowsePath(path)).toBe(true);
    }
    for (const path of [
      '/browse/create',
      '/browse/post/private',
      `/browse/post/${id}/edit`,
      '/post/x',
      '/chat/x',
      '/user/alice',
    ]) {
      expect(isGuestBrowsePath(path)).toBe(false);
    }
  });

  it('treats guest browse children as signed-out surfaces', () => {
    expect(isSignedOutSurface(['browse'], '/browse')).toBe(true);
    expect(isSignedOutSurface(['browse', 'map'], '/browse/map')).toBe(true);
    expect(isSignedOutSurface(['browse', 'user', '[handle]'], '/browse/user/alice')).toBe(true);
    expect(isSignedOutSurface(['browse', 'create'], '/browse/create')).toBe(false);
  });

  it('remaps member feed, post, map and profile deep links to guest routes', () => {
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
    expect(
      resolveAuthRedirect({
        ...base,
        segments: ['(tabs)', 'donations', 'marketplace', 'map'],
        pathname: '/donations/marketplace/map',
      }),
    ).toEqual({ kind: 'guest', href: '/browse/map' });
    expect(
      resolveAuthRedirect({
        ...base,
        segments: ['user', '[handle]'],
        pathname: '/user/alice',
      }),
    ).toEqual({ kind: 'guest', href: '/browse/user/alice' });
  });

  it('maps only the supported member paths to guest substitutes', () => {
    expect(guestReadableRedirect(`/post/${id}`)).toBe(`/browse/post/${id}`);
    expect(guestReadableRedirect('/post/42')).toBeNull();
    expect(guestReadableRedirect('/')).toBe('/browse');
    expect(guestReadableRedirect('/user/alice')).toBe('/browse/user/alice');
    expect(guestReadableRedirect('/donations/marketplace/map')).toBe('/browse/map');
    expect(guestReadableRedirect('/chat/x')).toBeNull();
  });

  it('restores only a valid member post after guest CTA sign-in', () => {
    expect(guestMemberIntent(id)).toBe(`/post/${id}`);
    expect(guestMemberIntent()).toBeNull();
    expect(guestMemberIntent('../chat/private')).toBeNull();
  });
});
