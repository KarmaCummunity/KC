import { describe, expect, it } from 'vitest';
import { loadApiConfig } from '../apiConfig';
import { configErrorOf, REQUIRED } from './configFixtures';

// The settings of the file stores and of KC's own identity: where files live and are copied
// from, and what makes this API an issuer of its members' tokens.
describe('loadApiConfig: files and identity', () => {
  it('reads the local file store and needs the address its URLs point at', () => {
    const config = loadApiConfig({ ...REQUIRED, KC_STORAGE_LOCAL_DIR: '/var/kc-files', KC_API_PUBLIC_URL: 'http://localhost:8080/' });

    expect(config.storage).toEqual({ localDirectory: '/var/kc-files', publicUrl: 'http://localhost:8080', cloud: null });
    expect(configErrorOf({ KC_STORAGE_LOCAL_DIR: '/var/kc-files' }).variable).toBe('KC_API_PUBLIC_URL');
    expect(configErrorOf({ KC_API_PUBLIC_URL: 'not a url' }).variable).toBe('KC_API_PUBLIC_URL');
  });

  it('reads the cloud file store: the prefix of its buckets and the media address public files are served from', () => {
    const config = loadApiConfig({ ...REQUIRED, KC_STORAGE_GCS_BUCKET_PREFIX: 'kc-dev-', KC_MEDIA_PUBLIC_URL: 'https://media.example.org/' });

    expect(config.storage).toEqual({ localDirectory: null, publicUrl: null, cloud: { bucketPrefix: 'kc-dev-', mediaUrl: 'https://media.example.org' } });
    expect(loadApiConfig(REQUIRED).storage.cloud).toBeNull();
  });

  it.each([
    [{ KC_STORAGE_GCS_BUCKET_PREFIX: 'kc-dev-' }, 'KC_MEDIA_PUBLIC_URL'],
    [{ KC_STORAGE_GCS_BUCKET_PREFIX: 'kc-dev-', KC_MEDIA_PUBLIC_URL: 'not a url' }, 'KC_MEDIA_PUBLIC_URL'],
    [{ KC_STORAGE_GCS_BUCKET_PREFIX: 'KC Dev/', KC_MEDIA_PUBLIC_URL: 'https://media.example.org' }, 'KC_STORAGE_GCS_BUCKET_PREFIX'],
    [{ KC_STORAGE_GCS_BUCKET_PREFIX: '-kc', KC_MEDIA_PUBLIC_URL: 'https://media.example.org' }, 'KC_STORAGE_GCS_BUCKET_PREFIX'],
    [{ KC_STORAGE_GCS_BUCKET_PREFIX: 'k'.repeat(51), KC_MEDIA_PUBLIC_URL: 'https://media.example.org' }, 'KC_STORAGE_GCS_BUCKET_PREFIX'],
    [
      { KC_STORAGE_GCS_BUCKET_PREFIX: 'kc-dev-', KC_MEDIA_PUBLIC_URL: 'https://media.example.org', KC_STORAGE_LOCAL_DIR: '/var/kc-files', KC_API_PUBLIC_URL: 'http://localhost:8080' },
      'KC_STORAGE_LOCAL_DIR',
    ],
  ])('refuses to start with a cloud file store that is half configured, misnamed, or beside a local one: %j', (env, variable) => {
    expect(configErrorOf(env).variable).toBe(variable);
  });

  it('reads the keys KC signs its own tokens with, only for an issuer that is this API', () => {
    const config = loadApiConfig({ ...REQUIRED, KC_AUTH_ISSUER: 'https://api.kc.test/v1/auth', KC_AUTH_SIGNING_KEYS: '{"keys":[]}' });

    expect(config).toMatchObject({ authIssuer: 'https://api.kc.test/v1/auth', authSigningKeys: '{"keys":[]}' });
    expect(configErrorOf({ KC_AUTH_SIGNING_KEYS: '{"keys":[]}' }).variable).toBe('KC_AUTH_ISSUER');
  });

  it('reads the addresses a link in an identity email may lead to, and refuses a list that is not addresses', () => {
    const config = loadApiConfig({ ...REQUIRED, KC_AUTH_REDIRECT_URLS: 'https://app.kc.test/auth/verify, karmacommunity://auth/callback ,' });

    expect(config.authRedirectUrls).toEqual(['https://app.kc.test/auth/verify', 'karmacommunity://auth/callback']);
    expect(configErrorOf({ KC_AUTH_REDIRECT_URLS: 'https://app.kc.test/auth/verify,/auth/reset' }).variable).toBe('KC_AUTH_REDIRECT_URLS');
  });

  it('reads the client ids KC is registered under at Google and Apple', () => {
    const config = loadApiConfig({ ...REQUIRED, KC_AUTH_GOOGLE_CLIENT_IDS: 'web.apps.googleusercontent.com, ios.apps.googleusercontent.com', KC_AUTH_APPLE_CLIENT_IDS: 'com.karmacommunity.app' });

    expect(config.signIn).toEqual({ googleClientIds: ['web.apps.googleusercontent.com', 'ios.apps.googleusercontent.com'], appleClientIds: ['com.karmacommunity.app'] });
  });

  it('reads where the existing files are copied from, and copies none without it', () => {
    const config = loadApiConfig({ ...REQUIRED, KC_STORAGE_COPY_SOURCE_URL: 'https://project.supabase.test/', KC_STORAGE_COPY_SOURCE_KEY: 'service-key' });

    expect(config.storageCopySource).toEqual({ url: 'https://project.supabase.test', key: 'service-key' });
    expect(loadApiConfig(REQUIRED).storageCopySource).toBeNull();
  });

  it.each([
    [{ KC_STORAGE_COPY_SOURCE_KEY: 'service-key' }, 'KC_STORAGE_COPY_SOURCE_URL'],
    [{ KC_STORAGE_COPY_SOURCE_URL: 'https://project.supabase.test' }, 'KC_STORAGE_COPY_SOURCE_KEY'],
    [{ KC_STORAGE_COPY_SOURCE_URL: 'not a url', KC_STORAGE_COPY_SOURCE_KEY: 'service-key' }, 'KC_STORAGE_COPY_SOURCE_URL'],
  ])('refuses to start with a copy source that is half configured or not an address: %j', (env, variable) => {
    expect(configErrorOf(env).variable).toBe(variable);
  });
});
