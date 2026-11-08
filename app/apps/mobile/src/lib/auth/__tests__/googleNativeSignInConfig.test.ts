// #1955: native Google sign-in runs only where the build carries the client IDs it needs.
import { describe, expect, it } from 'vitest';
import { resolveGoogleNativeSignInConfig } from '../googleNativeSignInConfig';

const WEB = '430191522654-web.apps.googleusercontent.com';
const IOS = '430191522654-ios.apps.googleusercontent.com';

describe('resolveGoogleNativeSignInConfig', () => {
  it('enables Android with the web client ID alone', () => {
    expect(resolveGoogleNativeSignInConfig('android', { googleWebClientId: WEB })).toEqual({ webClientId: WEB });
  });

  it('needs both the web and the iOS client IDs on iOS', () => {
    expect(resolveGoogleNativeSignInConfig('ios', { googleWebClientId: WEB })).toBeNull();
    expect(resolveGoogleNativeSignInConfig('ios', { googleWebClientId: WEB, googleIosClientId: IOS })).toEqual({
      webClientId: WEB,
      iosClientId: IOS,
    });
  });

  it('stays off without a web client ID', () => {
    expect(resolveGoogleNativeSignInConfig('android', {})).toBeNull();
    expect(resolveGoogleNativeSignInConfig('ios', { googleIosClientId: IOS })).toBeNull();
    expect(resolveGoogleNativeSignInConfig('android', undefined)).toBeNull();
  });

  it('ignores blank or non-string values', () => {
    expect(resolveGoogleNativeSignInConfig('android', { googleWebClientId: '  ' })).toBeNull();
    expect(resolveGoogleNativeSignInConfig('android', { googleWebClientId: 42 })).toBeNull();
  });

  it('never enables web, which keeps the redirect flow', () => {
    expect(resolveGoogleNativeSignInConfig('web', { googleWebClientId: WEB, googleIosClientId: IOS })).toBeNull();
  });
});
