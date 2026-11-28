import { bundleUrls, extractAnonKey, KC_DEV_SUPABASE_URL } from './maestro-dev-env.mjs';
import { validateTarget } from './native-exact-acceptance.mjs';
const url = process.env.PINNED_WEB_URL;
const text = async url => { const r = await fetch(url); if (!r.ok) throw new Error('Pinned public config unavailable'); return r.text(); };
validateTarget(process.env.CANDIDATE_SHA, url, JSON.parse(await text(new URL('/version.json', url))));
let key;
for (const bundle of bundleUrls(await text(url), url)) {
  key = extractAnonKey(await text(bundle), new URL(KC_DEV_SUPABASE_URL).hostname.split('.')[0]);
  if (key) break;
}
if (!key) throw new Error('Pinned DEV public key unavailable, no fallback');
process.stdout.write(`EXPO_PUBLIC_SUPABASE_URL=${KC_DEV_SUPABASE_URL}\nEXPO_PUBLIC_SUPABASE_ANON_KEY=${key}\n`);
