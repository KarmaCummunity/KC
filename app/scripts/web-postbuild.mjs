#!/usr/bin/env node
// Post-process the Expo web export for Cloudflare Pages (KC web at site root).
// See: https://developers.cloudflare.com/pages/configuration/redirects/

import { writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderHeadersFile } from './web-headers.mjs';
import { readAppVersion, renderVersionFile, resolveBuildSha } from './web-version.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const distDir = resolve(appRoot, 'apps', 'mobile', 'dist');
const redirectsPath = resolve(distDir, '_redirects');
const headersPath = resolve(distDir, '_headers');
const versionPath = resolve(distDir, 'version.json');

if (!existsSync(distDir)) {
  console.error(`[web-postbuild] dist not found at ${distDir} — did expo export run?`);
  process.exit(1);
}

// Legacy /glowe bookmarks: send to KC root (remove stale static tree after deploy).
writeFileSync(redirectsPath, '/glowe/*  /  302\n/glowe     /  302\n', 'utf8');
console.log(`[web-postbuild] wrote ${redirectsPath} (KC root + /glowe legacy redirects)`);

// Baseline response headers (see web-headers.mjs).
writeFileSync(headersPath, renderHeadersFile(), 'utf8');
console.log(`[web-postbuild] wrote ${headersPath}`);

// Build identity polled by the deploy smoke and the release lane (see web-version.mjs).
const stamp = {
  version: readAppVersion(resolve(appRoot, 'VERSION')),
  sha: resolveBuildSha(process.env),
  builtAt: new Date().toISOString(),
};
writeFileSync(versionPath, renderVersionFile(stamp), 'utf8');
console.log(`[web-postbuild] wrote ${versionPath} (v${stamp.version} @ ${stamp.sha})`);
if (stamp.sha === 'unknown') console.warn('[web-postbuild] no commit SHA available; the deploy smoke will reject this build');
