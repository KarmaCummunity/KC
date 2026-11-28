// Unsigned simulator smoke uses only public DEV configuration, never a member login.
import { bundleUrls, extractAnonKey, KC_DEV_SUPABASE_URL, DEFAULT_DEV_WEB_URL } from './maestro-dev-env.mjs';
const text = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Public DEV config request failed: ${response.status}`);
  return response.text();
};
const ref = new URL(KC_DEV_SUPABASE_URL).hostname.split('.')[0];
let key;
for (const url of bundleUrls(await text(DEFAULT_DEV_WEB_URL), DEFAULT_DEV_WEB_URL)) {
  key = extractAnonKey(await text(url), ref);
  if (key) break;
}
if (!key) throw new Error('No public DEV anon key found; no fallback to production');
process.stdout.write(`EXPO_PUBLIC_SUPABASE_URL=${KC_DEV_SUPABASE_URL}\nEXPO_PUBLIC_SUPABASE_ANON_KEY=${key}\n`);
