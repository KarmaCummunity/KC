#!/usr/bin/env node
/**
 * Upload demo JPEG fixtures to kc-dev `post-images` (paths under demo/kc-dev/**).
 * DEV ONLY — requires service role. Idempotent (upsert).
 *
 *   cd app && pnpm exec node ../supabase/seed/kc-dev/upload-demo-storage.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.SUPABASE_URL ?? process.env.KC_DEV_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.KC_DEV_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (kc-dev service role).');
  process.exit(1);
}

const bucket = 'post-images';
const baseDir = join(fileURLToPath(new URL('.', import.meta.url)), 'storage', 'post-images');

async function collectJpegs(dir) {
  const out = [];
  for (const name of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) out.push(...(await collectJpegs(full)));
    else if (/\.jpe?g$/i.test(name.name)) out.push(full);
  }
  return out;
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const files = await collectJpegs(baseDir);
let ok = 0;
for (const file of files) {
  const objectPath = relative(baseDir, file).split('\\').join('/');
  const body = await readFile(file);
  const { error } = await supabase.storage.from(bucket).upload(objectPath, body, {
    contentType: 'image/jpeg',
    upsert: true,
    cacheControl: 'public, max-age=31536000, immutable',
  });
  if (error) {
    console.error(`FAIL ${objectPath}:`, error.message);
    process.exitCode = 1;
  } else {
    ok += 1;
    console.log(`OK ${objectPath}`);
  }
}
console.log(`Uploaded ${ok}/${files.length} objects to ${bucket}`);
