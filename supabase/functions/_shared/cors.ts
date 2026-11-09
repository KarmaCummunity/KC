// _shared/cors.ts
// Shared CORS helper for Edge Functions that serve public-facing requests.
// Origin allowlist is read from PUBLIC_RESEARCH_ALLOWED_ORIGINS (comma-separated)
// and always merged with local Expo/web dev origins so local UI never breaks
// when the remote env var is set for production hosts only.

const RAW = (Deno.env.get('PUBLIC_RESEARCH_ALLOWED_ORIGINS') ?? '').trim();

const DEV_ORIGINS = [
  'http://localhost:8081',
  'http://localhost:19006',
  'http://localhost:4321',
  'http://127.0.0.1:4321',
  'http://[::1]:4321',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://[::1]:3000',
];

// KC Cloudflare Pages hosts. Always allowed so Edge Functions work on dev/prod
// deploys even when PUBLIC_RESEARCH_ALLOWED_ORIGINS only lists other origins.
const KC_PAGES_ORIGINS = [
  'https://dev.karma-community.pages.dev',
  'https://karma-community-kc.com',
  'https://www.karma-community-kc.com',
];

const FROM_ENV = RAW
  ? RAW.split(',').map((s) => s.trim()).filter(Boolean)
  : [];

export const ALLOWED_ORIGINS: string[] = [...new Set([...DEV_ORIGINS, ...KC_PAGES_ORIGINS, ...FROM_ENV])];

// Local loopback on any port (Live Server, Vite, Cursor preview, etc.) and
// Cloudflare Pages preview deploys (https://<hash>.karma-community.pages.dev)
// must reach Edge Functions — a silent CORS miss breaks client calls with no log.
const LOCAL_LOOPBACK =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const KC_PAGES_PREVIEW =
  /^https:\/\/([a-z0-9-]+\.)?karma-community\.pages\.dev$/i;

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (LOCAL_LOOPBACK.test(origin)) return true;
  if (KC_PAGES_PREVIEW.test(origin)) return true;
  return false;
}

export function corsHeaders(origin: string | null): Record<string, string> {
  if (!isAllowedOrigin(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin!,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
