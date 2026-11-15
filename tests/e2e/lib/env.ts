/**
 * Shared E2E environment for the kc-dev QA suite.
 * Defaults target dev (https://dev.karma-community.pages.dev + kc-dev Supabase) and the
 * the e2e members user1…user4@seed.kc.test from supabase/seed/e2e/load.sql (the Seed KC dev workflow, action e2e-users).
 * Never point this at production.
 */

export const BASE_URL = (process.env.DEV_WEB_URL ?? 'https://dev.karma-community.pages.dev').replace(/\/$/, '');
export const SUPABASE_URL = (process.env.E2E_SUPABASE_URL ?? 'https://enbqriuxvvuontiwslun.supabase.co').replace(/\/$/, '');

if (/kdqtbdbzwvlugkhonexg/.test(SUPABASE_URL) || /karma-community-kc\.com/.test(BASE_URL)) {
  throw new Error('E2E suite refuses to run against production.');
}

/** Seed users' password: the E2E_SEED_PASSWORD secret. Fails fast when unset. */
function seedPassword(): string {
  const value = process.env.E2E_SEED_PASSWORD?.trim();
  if (!value) throw new Error('E2E_SEED_PASSWORD is not set (seed password secret).');
  return value;
}
const SEED_PASSWORD = seedPassword();
export const USER_A = {
  email: process.env.E2E_USER_A_EMAIL ?? 'user1@seed.kc.test',
  password: process.env.E2E_USER_A_PASSWORD ?? SEED_PASSWORD,
};
export const USER_B = {
  email: process.env.E2E_USER_B_EMAIL ?? 'user2@seed.kc.test',
  password: process.env.E2E_USER_B_PASSWORD ?? SEED_PASSWORD,
};

let cachedAnon: string | undefined;

/** Publishable anon key: env first, else read it from the deployed web bundle (it is public). */
export async function anonKey(): Promise<string> {
  if (process.env.E2E_SUPABASE_ANON_KEY) return process.env.E2E_SUPABASE_ANON_KEY;
  if (cachedAnon) return cachedAnon;
  const html = await (await fetch(`${BASE_URL}/`)).text();
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
  for (const m of html.matchAll(/\/_expo\/static\/js\/web\/[^"']+\.js/g)) {
    const js = await (await fetch(`${BASE_URL}${m[0]}`)).text();
    for (const k of js.matchAll(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
      const payload = JSON.parse(Buffer.from(k[0].split('.')[1]!, 'base64url').toString());
      if (payload.role === 'anon' && payload.ref === ref) return (cachedAnon = k[0]);
    }
    const pub = js.match(/sb_publishable_[A-Za-z0-9_-]+/);
    if (pub) return (cachedAnon = pub[0]);
  }
  throw new Error('Could not find the Supabase anon key; set E2E_SUPABASE_ANON_KEY.');
}

export const STORAGE_A = '.auth/user-a.json';
export const STORAGE_B = '.auth/user-b.json';
