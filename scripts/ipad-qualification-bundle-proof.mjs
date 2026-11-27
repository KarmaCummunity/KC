// DEV diagnostic proof only. Never print compiled app contents or configuration.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Fixed ASCII strings survive both plain JS and Hermes string tables. */
export function bundleHasStartupMarkers(bytes) {
  return ['module-loaded', 'rtl-read-start'].every((stage) =>
    bytes.includes(Buffer.from(`KC_STARTUP_DIAGNOSTIC ${stage}`)),
  );
}
function bundlesIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? bundlesIn(path) : /\.(jsbundle|hbc)$/.test(entry.name) ? [path] : [];
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bundles = bundlesIn(process.argv[2]);
  if (!bundles.some((path) => bundleHasStartupMarkers(readFileSync(path)))) {
    throw new Error('DEV diagnostic startup markers missing from compiled app bundles');
  }
  process.stdout.write('Compiled DEV bundle contains fixed startup markers. Not production acceptance.\n');
}
