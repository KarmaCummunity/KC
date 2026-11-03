#!/usr/bin/env node
/**
 * Generates app/apps/mobile/public/manifest.json from the he locale file and the
 * design tokens. Run as part of the web build so Hebrew lives only in the locale
 * bundle (D-24) and the PWA colours follow the brand tokens (spec 17 §2, #1290).
 *
 * Sources of truth:
 *   app name  → app/apps/mobile/src/i18n/locales/he/index.ts → appName
 *   colours   → app/packages/ui/tokens/kc.tokens.json (generated from theme/*.ts):
 *               background_color = light `background`, theme_color = `primaryVivid`
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..');

/** The Hebrew `appName` from the locale bundle; throws when the key is missing. */
export function readAppName(repoRoot) {
  const localeFile = path.join(repoRoot, 'app/apps/mobile/src/i18n/locales/he/index.ts');
  const nameMatch = fs.readFileSync(localeFile, 'utf8').match(/appName:\s*['"](.+?)['"]/);
  if (!nameMatch) throw new Error(`Could not find appName in ${localeFile}`);
  return nameMatch[1];
}

/** The manifest colours from the generated W3C token file: the light backdrop and the decoration orange. */
export function readBrandColours(repoRoot) {
  const tokensFile = path.join(repoRoot, 'app/packages/ui/tokens/kc.tokens.json');
  const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf8'));
  const light = tokens.color?.light ?? {};
  const background = light.background?.$value;
  const themeColor = light.primaryVivid?.$value;
  if (typeof background !== 'string' || typeof themeColor !== 'string') {
    throw new Error(`Could not read color.light.background / primaryVivid from ${tokensFile}`);
  }
  return { background, themeColor };
}

/** The PWA manifest for the given name and colours (pure, so the test can pin it). */
export function buildManifest(appName, { background, themeColor }) {
  return {
    name: appName,
    short_name: 'KC',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: background,
    theme_color: themeColor,
    lang: 'he',
    dir: 'rtl',
    icons: [
      { src: '/pwa-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/pwa-icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

function main() {
  const repoRoot = DEFAULT_REPO_ROOT;
  const outFile = path.join(repoRoot, 'app/apps/mobile/public/manifest.json');
  let manifest;
  try {
    manifest = buildManifest(readAppName(repoRoot), readBrandColours(repoRoot));
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
  fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Generated ${path.relative(repoRoot, outFile)} — name: "${manifest.name}"`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
