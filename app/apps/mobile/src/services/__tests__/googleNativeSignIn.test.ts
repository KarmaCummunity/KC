// #1955: the native Google adapter maps every SDK outcome onto token / cancelled / unavailable.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  configure: vi.fn(),
  hasPlayServices: vi.fn(async () => true),
  signOut: vi.fn(async () => null),
  signIn: vi.fn(),
}));
const captureException = vi.hoisted(() => vi.fn());

vi.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: sdk,
  statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED', IN_PROGRESS: 'IN_PROGRESS' },
  isErrorWithCode: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
  isSuccessResponse: (r: { type: string }) => r.type === 'success',
}));
vi.mock('../../lib/observability/sentry', () => ({ getSentryIfInit: () => ({ captureException }) }));

import { createGoogleIdTokenRequester } from '../googleNativeSignIn';

const CONFIG = { webClientId: 'web.apps.googleusercontent.com', iosClientId: 'ios.apps.googleusercontent.com' };
const codeError = (code: string) => Object.assign(new Error(code), { code });

beforeEach(() => {
  vi.clearAllMocks();
  sdk.hasPlayServices.mockResolvedValue(true);
  sdk.signOut.mockResolvedValue(null);
});

describe('createGoogleIdTokenRequester', () => {
  it('returns the ID token and configures the SDK once with the client IDs', async () => {
    sdk.signIn.mockResolvedValue({ type: 'success', data: { idToken: 'id.jwt' } });
    const request = createGoogleIdTokenRequester(CONFIG);

    expect(await request()).toEqual({ kind: 'token', idToken: 'id.jwt' });
    await request();
    expect(sdk.configure).toHaveBeenCalledOnce();
    expect(sdk.configure).toHaveBeenCalledWith(CONFIG);
  });

  it('clears the remembered account before each sign-in so the picker shows', async () => {
    sdk.signIn.mockResolvedValue({ type: 'success', data: { idToken: 'id.jwt' } });
    await createGoogleIdTokenRequester(CONFIG)();
    expect(sdk.signOut.mock.invocationCallOrder[0]).toBeLessThan(sdk.signIn.mock.invocationCallOrder[0]);
  });

  it('treats a closed sheet, a cancel error or a sign-in in progress as cancelled', async () => {
    const request = createGoogleIdTokenRequester(CONFIG);
    sdk.signIn.mockResolvedValueOnce({ type: 'cancelled', data: null });
    expect(await request()).toEqual({ kind: 'cancelled' });
    sdk.signIn.mockRejectedValueOnce(codeError('SIGN_IN_CANCELLED'));
    expect(await request()).toEqual({ kind: 'cancelled' });
    sdk.signIn.mockRejectedValueOnce(codeError('IN_PROGRESS'));
    expect(await request()).toEqual({ kind: 'cancelled' });
    expect(captureException).not.toHaveBeenCalled();
  });

  it('falls back (unavailable) and reports when Play services or the OAuth client fail', async () => {
    const request = createGoogleIdTokenRequester(CONFIG);
    sdk.hasPlayServices.mockRejectedValueOnce(codeError('PLAY_SERVICES_NOT_AVAILABLE'));
    expect(await request()).toEqual({ kind: 'unavailable' });
    sdk.signIn.mockRejectedValueOnce(codeError('DEVELOPER_ERROR'));
    expect(await request()).toEqual({ kind: 'unavailable' });
    expect(captureException).toHaveBeenCalledTimes(2);
    expect(captureException.mock.calls[1][1]).toMatchObject({ tags: { sdk_code: 'DEVELOPER_ERROR' } });
  });

  it('falls back when Google returns no ID token', async () => {
    sdk.signIn.mockResolvedValue({ type: 'success', data: { idToken: null } });
    expect(await createGoogleIdTokenRequester(CONFIG)()).toEqual({ kind: 'unavailable' });
    expect(captureException).toHaveBeenCalledOnce();
  });
});
