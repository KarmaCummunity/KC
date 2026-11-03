import type { ConfigContext, ExpoConfig } from 'expo/config';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Marketing version — single source of truth: `app/VERSION`. */
function readAppVersion(): string {
  const versionPath = join(__dirname, '../../VERSION');
  return readFileSync(versionPath, 'utf8').trim();
}

// The explicit EXPO_PUBLIC_GIT_COMMIT_SHA wins over GITHUB_SHA: the deploy
// pipeline runs on `workflow_run`, where GITHUB_SHA is the default branch tip,
// not the deployed commit.
function resolveGitCommitSha(): string {
  const sha =
    process.env.EAS_BUILD_GIT_COMMIT_HASH ??
    process.env.EXPO_PUBLIC_GIT_COMMIT_SHA ??
    process.env.GITHUB_SHA ??
    '';
  return sha.trim().slice(0, 7);
}

function applySentryBuildDefaults(): void {
  const token = process.env.SENTRY_AUTH_TOKEN?.trim();
  if (!token) {
    process.env.SENTRY_DISABLE_AUTO_UPLOAD = 'true';
    return;
  }
  delete process.env.SENTRY_DISABLE_AUTO_UPLOAD;
  if (!process.env.SENTRY_ORG?.trim()) {
    process.env.SENTRY_ORG = 'karma-community';
  }
  if (!process.env.SENTRY_URL?.trim()) {
    process.env.SENTRY_URL = 'https://de.sentry.io/';
  }
}

function warnMissingSupabaseEnv(profile: string | undefined): void {
  if (process.env.EAS_BUILD !== 'true' && !process.env.CI) return;
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    console.warn(
      `[app.config] EAS profile "${profile ?? 'unknown'}" is missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY`,
    );
  }
}

function resolveGoogleServicesFile(): string | undefined {
  const fromEnv = process.env.GOOGLE_SERVICES_JSON?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const local = join(__dirname, 'google-services.json');
  if (existsSync(local)) return './google-services.json';
  return undefined;
}

/**
 * Maestro E2E builds (`KC_E2E_BUILD=1`, KC#1235) must run the JS bundle embedded in the APK
 * under test; an OTA update from the EAS channel would replace it with older `dev` code.
 */
function isE2eBuild(): boolean {
  return process.env.KC_E2E_BUILD === '1';
}

export default function expoAppConfig({ config }: ConfigContext): ExpoConfig {
  const easProjectId = process.env.EAS_PROJECT_ID?.trim() || config.extra?.eas?.projectId;
  applySentryBuildDefaults();
  warnMissingSupabaseEnv(process.env.EAS_BUILD_PROFILE);

  const googleServicesFile = resolveGoogleServicesFile();
  const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
  const android = {
    ...config.android,
    ...(googleServicesFile ? { googleServicesFile } : {}),
    config: {
      ...config.android?.config,
      ...(googleMapsApiKey ? { googleMaps: { apiKey: googleMapsApiKey } } : {}),
    },
  };

  return {
    ...config,
    android,
    version: readAppVersion(),
    // OTA (expo-updates): the EAS Update channels in eas.json serve this project.
    updates: {
      ...config.updates,
      url: `https://u.expo.dev/${easProjectId}`,
      ...(isE2eBuild() ? { enabled: false } : {}),
    },
    extra: {
      ...config.extra,
      gitCommitSha: resolveGitCommitSha(),
      supabaseConfigured: Boolean(
        process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() &&
          process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim(),
      ),
      sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN?.trim() || undefined,
      posthogKey: process.env.EXPO_PUBLIC_POSTHOG_KEY?.trim() || undefined,
      // EAS project id is injected from the KC_EAS_PROJECT_ID repo variable (CI) or local env.
      eas: { ...config.extra?.eas, projectId: easProjectId },
    },
  } as ExpoConfig;
}
