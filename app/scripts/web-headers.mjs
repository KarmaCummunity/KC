// Cloudflare Pages `_headers` for the KC web export.
// See: https://developers.cloudflare.com/pages/configuration/headers/
//
// Conservative baseline only: none of these change what the SPA can load.
// A full Content-Security-Policy (script/connect sources) is a separate,
// tested change — here CSP carries `frame-ancestors` alone.

/** Headers applied to every response. */
export const BASELINE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  // Legacy browsers read X-Frame-Options; modern ones read frame-ancestors.
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // No includeSubDomains: other subdomains of the prod domain are not ours to pin.
  'Strict-Transport-Security': 'max-age=31536000',
  // Own origin only: geolocation (location picker) and camera (avatar capture); no microphone use.
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(self)',
};

/**
 * Apple and Android fetch these app-link manifests and require JSON.
 * `apple-app-site-association` has no extension, so Pages would not infer it.
 */
export const WELL_KNOWN_JSON_PATHS = ['/.well-known/apple-app-site-association', '/.well-known/assetlinks.json'];

/**
 * Build identity polled by the deploy smoke right after a deploy; a cached
 * copy would report the previous build's SHA.
 */
export const VERSION_PATH = '/version.json';

/** Renders the `_headers` file body. */
export function renderHeadersFile() {
  const block = (path, headers) =>
    [path, ...Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`)].join('\n');
  const blocks = [
    block('/*', BASELINE_HEADERS),
    ...WELL_KNOWN_JSON_PATHS.map((path) => block(path, { 'Content-Type': 'application/json' })),
    block(VERSION_PATH, { 'Cache-Control': 'no-store' }),
  ];
  return `${blocks.join('\n\n')}\n`;
}
