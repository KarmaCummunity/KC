#!/usr/bin/env node
// Guard for the universal-link / app-link manifests (public/.well-known).
//
// Fails when apple-app-site-association or assetlinks.json holds a placeholder,
// names another app than app.json, or does not cover every path the Android
// intent filters (and the auth round-trip) rely on. With --dist <dir> it also
// proves the web export shipped both files byte-for-byte and that the generated
// _headers serves them as application/json (the deploy smoke then checks the
// live response: status, content type, no redirect).
//
// Usage: node app/scripts/check-well-known-links.mjs [--dist app/apps/mobile/dist]

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MOBILE = resolve(here, '..', 'apps', 'mobile');
export const AASA = 'apple-app-site-association';
export const ASSETLINKS = 'assetlinks.json';
const TEAM_ID = /^[A-Z0-9]{10}$/;
const SHA256 = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
/** Paths every build must claim: the OAuth return and the unlinked review sign-in. */
export const REQUIRED_PATHS = ['/auth/callback', '/sign-in'];

/** Path prefixes the Android intent filters register for `host`. */
export function androidPathPrefixes(appJson, host) {
  const filters = appJson.expo?.android?.intentFilters ?? [];
  return filters
    .flatMap((f) => f.data ?? [])
    .filter((d) => d.scheme === 'https' && d.host === host && d.pathPrefix)
    .map((d) => d.pathPrefix);
}

/** True when an AASA `paths` entry (exact or `prefix*`) covers `prefix`. */
function covers(paths, prefix) {
  return paths.some((p) => p === prefix || p === `${prefix}*` || p === `${prefix}/*`);
}

/** Problems with the manifests; an empty list means they are valid for this app. */
export function validate({ aasa, assetlinks, appJson }) {
  const problems = [];
  const bundle = appJson.expo?.ios?.bundleIdentifier;
  const pkg = appJson.expo?.android?.package;
  const domains = appJson.expo?.ios?.associatedDomains ?? [];
  const host = domains.find((d) => d.startsWith('applinks:'))?.slice('applinks:'.length);
  if (!bundle || !pkg || !host) return ['app.json lacks ios.bundleIdentifier, android.package or an applinks: associated domain'];

  const detail = aasa?.applinks?.details?.[0];
  const appID = detail?.appID ?? '';
  const [team, ...rest] = appID.split('.');
  if (!TEAM_ID.test(team) || rest.join('.') !== bundle) problems.push(`AASA appID "${appID}" must be <10-char Team ID>.${bundle}`);
  const paths = detail?.paths ?? [];
  for (const prefix of [...new Set([...REQUIRED_PATHS, ...androidPathPrefixes(appJson, host)])]) {
    if (!covers(paths, prefix)) problems.push(`AASA paths do not cover ${prefix} (claimed by the app)`);
  }
  if (domains.some((d) => d.startsWith('webcredentials:')) && !aasa?.webcredentials?.apps?.includes(appID)) {
    problems.push(`AASA webcredentials.apps must list ${appID} (app.json declares webcredentials:${host})`);
  }

  const target = assetlinks?.[0]?.target;
  if (target?.namespace !== 'android_app' || target.package_name !== pkg) problems.push(`assetlinks package_name must be ${pkg}`);
  const prints = target?.sha256_cert_fingerprints ?? [];
  if (prints.length < 2) problems.push('assetlinks needs the Play app-signing key and the upload key (2 SHA-256 fingerprints)');
  for (const f of prints) if (!SHA256.test(f)) problems.push(`assetlinks fingerprint "${f}" is not a colon-separated upper-case SHA-256`);
  if (new Set(prints).size !== prints.length) problems.push('assetlinks lists a fingerprint twice');
  return problems;
}

/** Problems with the built web export (`dist`): both files shipped unchanged and served as JSON. */
export function validateDist(distDir, readSource = (name) => readFileSync(join(MOBILE, 'public', '.well-known', name), 'utf8')) {
  const problems = [];
  for (const name of [AASA, ASSETLINKS]) {
    const built = join(distDir, '.well-known', name);
    if (!existsSync(built)) problems.push(`dist/.well-known/${name} missing from the web export`);
    else if (readFileSync(built, 'utf8') !== readSource(name)) problems.push(`dist/.well-known/${name} differs from public/.well-known/${name}`);
  }
  const headers = existsSync(join(distDir, '_headers')) ? readFileSync(join(distDir, '_headers'), 'utf8') : '';
  for (const name of [AASA, ASSETLINKS]) {
    if (!new RegExp(`/\\.well-known/${name.replace('.', '\\.')}\\n {2}Content-Type: application/json`).test(headers)) {
      problems.push(`dist/_headers has no application/json rule for /.well-known/${name}`);
    }
  }
  return problems;
}

function main() {
  const wk = join(MOBILE, 'public', '.well-known');
  const parse = (p) => {
    try {
      return JSON.parse(readFileSync(p, 'utf8'));
    } catch (err) {
      return { __error: `${p}: ${err.message}` };
    }
  };
  const aasa = parse(join(wk, AASA));
  const assetlinks = parse(join(wk, ASSETLINKS));
  const appJson = parse(join(MOBILE, 'app.json'));
  const broken = [aasa, assetlinks, appJson].find((x) => x?.__error);
  const problems = broken ? [broken.__error] : validate({ aasa, assetlinks, appJson });
  const dist = process.argv.indexOf('--dist');
  if (dist > 0) problems.push(...validateDist(resolve(process.argv[dist + 1])));
  for (const p of problems) console.error(`::error title=deep-link manifests::${p}`);
  if (problems.length) process.exit(1);
  console.log(`deep-link manifests OK${dist > 0 ? ' (web export verified)' : ''}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
