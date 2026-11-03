// Every npm package an Edge Function imports through esm.sh or `npm:` names an exact
// version. A range such as `@2` resolves to whatever release is current at deploy time,
// so two functions can bundle different clients, and the dependency audit
// (scripts/check-dependency-audit.mjs, #1373) cannot check it. TD-260.
import { assertEquals } from 'jsr:@std/assert@1';

const FUNCTIONS_ROOT = new URL('../', import.meta.url);
const SOURCE = /\.(?:[cm]?[jt]s|tsx)$/;
// Same specifier shapes the audit reads: `https://esm.sh/<name>@<version>`, `npm:<name>@<version>`.
const NPM_IMPORT = /(?:https:\/\/esm\.sh\/|\bnpm:)((?:@[\w.-]+\/)?[\w.-]+)@([^/?#'"`\s]+)/g;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Repository-relative paths of every source file under supabase/functions. */
async function sourceFiles(dir: URL, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory) files.push(...(await sourceFiles(new URL(`${entry.name}/`, dir), `${path}/`)));
    else if (SOURCE.test(entry.name)) files.push(path);
  }
  return files;
}

/** `file: name@range` for each import in the text that does not pin an exact version. */
export function rangeImports(path: string, text: string): string[] {
  return [...text.matchAll(NPM_IMPORT)]
    .filter(([, , version]) => !EXACT_VERSION.test(version))
    .map(([, name, version]) => `${path}: ${name}@${version}`);
}

Deno.test('rangeImports flags ranges and accepts exact pins', () => {
  const text = [
    "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';",
    "import { createClient as c2 } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno';",
    "import Stripe from 'npm:stripe@^17';",
    "import { Jimp } from 'https://esm.sh/jimp@1.6.0';",
  ].join('\n');
  assertEquals(rangeImports('f.ts', text), ['f.ts: @supabase/supabase-js@2', 'f.ts: stripe@^17']);
});

Deno.test('every Edge Function npm import pins an exact version', async () => {
  const offenders: string[] = [];
  for (const path of await sourceFiles(FUNCTIONS_ROOT)) {
    offenders.push(...rangeImports(path, await Deno.readTextFile(new URL(path, FUNCTIONS_ROOT))));
  }
  // The test file itself quotes range imports as fixtures.
  assertEquals(offenders.filter((o) => !o.startsWith('_shared/pinnedImports.test.ts')), []);
});
