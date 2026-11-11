// Runtime configuration of the shared-link function.
//
// Two layers, the second wins: the file written at deploy time (`generatedConfig.mjs`, from the
// same public build variables the web bundle is built with) and the Pages project's own
// variables (`context.env`), which let an operator change a value without a deploy.
// Nothing here is a secret: the Supabase anon key ships inside the public web bundle too.

import { BUILD_CONFIG } from './generatedConfig.mjs';

const DEFAULT_APP_BASE_URL = 'https://karma-community-kc.com';

/** Strip trailing `/` characters without a backtracking regex. */
export function trimTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

function pick(env, key) {
  const fromEnv = typeof env?.[key] === 'string' ? env[key].trim() : '';
  if (fromEnv) return fromEnv;
  const fromBuild = typeof BUILD_CONFIG[key] === 'string' ? BUILD_CONFIG[key].trim() : '';
  return fromBuild;
}

/** Only an https URL may become a redirect target; anything else is treated as "not configured". */
function httpsUrlOrEmpty(value) {
  try {
    return new URL(value).protocol === 'https:' ? value : '';
  } catch {
    return '';
  }
}

/** @param {Record<string, unknown> | undefined} env the Pages `context.env` */
export function resolveConfig(env) {
  return {
    supabaseUrl: trimTrailingSlashes(pick(env, 'SUPABASE_URL')),
    supabaseAnonKey: pick(env, 'SUPABASE_ANON_KEY'),
    appBaseUrl: trimTrailingSlashes(pick(env, 'APP_BASE_URL') || DEFAULT_APP_BASE_URL),
    // An empty store URL disables the redirect for that platform (the app is not listed yet).
    storeLinks: {
      ios: httpsUrlOrEmpty(pick(env, 'KC_IOS_STORE_URL')),
      android: httpsUrlOrEmpty(pick(env, 'KC_ANDROID_STORE_URL')),
    },
  };
}
