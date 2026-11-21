import { describe, expect, it } from 'vitest';
import { guestMemberIntent, isGuestBrowsePath } from '../guestBrowsePaths';
import { isSignedOutSurface } from '../signedOutSurfaces';
import { resolveAuthRedirect } from '../authRedirect';
const id = '40000000-0000-4000-8000-000000000001';
describe('minimal guest routes', () => {
  it('allows only the dedicated browse and UUID detail routes', () => {
    for (const path of ['/browse', '/browse/', `/browse/post/${id}`]) expect(isGuestBrowsePath(path)).toBe(true);
    for (const path of ['/browse/create', '/browse/post/private', `/browse/post/${id}/edit`, '/browse//post/x', '/post/x', '/chat/x']) expect(isGuestBrowsePath(path)).toBe(false);
  });
  it('never opens member routes or unknown browse children', () => {
    expect(isSignedOutSurface(['browse'], '/browse')).toBe(true);
    expect(isSignedOutSurface(['browse', 'post', '[id]'], `/browse/post/${id}`)).toBe(true);
    expect(isSignedOutSurface(['browse', 'create'], '/browse/create')).toBe(false);
    for (const head of ['post', 'chat', 'create', '(tabs)']) expect(isSignedOutSurface([head], `/${head}/${id}`)).toBe(false);
  });
  it('keeps guest browsing in place but preserves sign-in gating elsewhere', () => {
    const base = { navigationReady: true, isLoading: false, isAuthenticated: false, onboardingState: null, basicInfoSkipped: null };
    expect(resolveAuthRedirect({ ...base, segments: ['browse'], pathname: '/browse' }).kind).toBe('stay');
    expect(resolveAuthRedirect({ ...base, segments: ['post', '[id]'], pathname: `/post/${id}` })).toEqual({ kind: 'welcome', rememberPath: `/post/${id}` });
  });
  it('restores only a valid member post after guest CTA sign-in', () => {
    expect(guestMemberIntent(id)).toBe(`/post/${id}`);
    expect(guestMemberIntent()).toBeNull();
    expect(guestMemberIntent('../chat/private')).toBeNull();
  });
});
