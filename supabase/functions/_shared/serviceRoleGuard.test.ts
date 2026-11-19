// _shared/serviceRoleGuard.test.ts — run: deno test --allow-read (from supabase/functions)
import { assert, assertEquals, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { currentServiceRoleKeys, isServiceRoleRequest, primaryServiceRoleKey, SERVICE_ROLE_ONLY_FUNCTIONS } from './serviceRoleGuard.ts';

const SERVICE_KEY = 'service-role-key-for-tests';

const req = (authorization?: string) =>
  new Request('https://x/functions/v1/worker', {
    method: 'POST',
    headers: authorization === undefined ? {} : { Authorization: authorization },
  });

Deno.test('accepts the service-role key as a bearer token', () => {
  assert(isServiceRoleRequest(req(`Bearer ${SERVICE_KEY}`), SERVICE_KEY));
});

Deno.test('rejects a missing header, another key, a prefix of the key and a non-bearer scheme', () => {
  assertFalse(isServiceRoleRequest(req(), SERVICE_KEY));
  assertFalse(isServiceRoleRequest(req('Bearer anon-key'), SERVICE_KEY));
  assertFalse(isServiceRoleRequest(req(`Bearer ${SERVICE_KEY.slice(0, -1)}`), SERVICE_KEY));
  assertFalse(isServiceRoleRequest(req(`Bearer ${SERVICE_KEY}x`), SERVICE_KEY));
  assertFalse(isServiceRoleRequest(req(SERVICE_KEY), SERVICE_KEY));
});

Deno.test('rejects every request when the function has no service-role key configured', () => {
  assertFalse(isServiceRoleRequest(req('Bearer '), ''));
  assertFalse(isServiceRoleRequest(req('Bearer undefined'), ''));
  assertFalse(isServiceRoleRequest(req(`Bearer ${SERVICE_KEY}`), []));
  assertFalse(isServiceRoleRequest(req(`Bearer ${SERVICE_KEY}`), ['']));
});

Deno.test('accepts an array of keys on any element and rejects a non-member', () => {
  const keys = ['sb_secret_new_default', SERVICE_KEY];
  assert(isServiceRoleRequest(req('Bearer sb_secret_new_default'), keys));
  assert(isServiceRoleRequest(req(`Bearer ${SERVICE_KEY}`), keys));
  assertFalse(isServiceRoleRequest(req('Bearer anon-key'), keys));
  assertFalse(isServiceRoleRequest(req(), keys));
});

Deno.test('currentServiceRoleKeys collects the injected key and comma-separated extras', () => {
  const env = (vars: Record<string, string>) => ({ get: (name: string) => vars[name] });
  assertEquals(
    currentServiceRoleKeys(env({ SUPABASE_SERVICE_ROLE_KEY: 'legacy', SUPABASE_SECRET_KEYS: 'sb_secret_a, sb_secret_b' })),
    ['legacy', 'sb_secret_a', 'sb_secret_b'],
  );
  assertEquals(currentServiceRoleKeys(env({ SUPABASE_SERVICE_ROLE_KEY: 'legacy' })), ['legacy']);
  assertEquals(currentServiceRoleKeys(env({ SUPABASE_SECRET_KEYS: 'sb_secret_a' })), ['sb_secret_a']);
  assertEquals(currentServiceRoleKeys(env({})), []);
  assertEquals(
    currentServiceRoleKeys(env({ SUPABASE_SERVICE_ROLE_KEY: 'same', SUPABASE_SECRET_KEYS: 'same, , other ,' })),
    ['same', 'other'],
  );
  assertEquals(primaryServiceRoleKey(env({ SUPABASE_SERVICE_ROLE_KEY: 'legacy', SUPABASE_SECRET_KEYS: 'sb_secret_a' })), 'legacy');
  assertEquals(primaryServiceRoleKey(env({})), '');
});

/** The file holding a function's request handler: `handler.ts` when it has one, else `index.ts`. */
async function handlerSource(name: string): Promise<{ file: string; source: string }> {
  for (const file of ['handler.ts', 'index.ts']) {
    try {
      return { file, source: await Deno.readTextFile(new URL(`../${name}/${file}`, import.meta.url)) };
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  }
  throw new Error(`${name} has neither handler.ts nor index.ts`);
}

// Regression guard: each service-role-only worker checks its caller before it reads the
// request body or opens its service-role client, i.e. right after its method guard.
for (const name of SERVICE_ROLE_ONLY_FUNCTIONS) {
  Deno.test(`${name} rejects callers without the service-role key before doing any work`, async () => {
    const { file, source } = await handlerSource(name);
    // The handler's own start: `async (req …` also fits a handler declared apart from `serve(`.
    const start = Math.max(source.search(/async \(req\b/), 0);
    const guard = source.indexOf('isServiceRoleRequest(req', start);
    assert(guard > 0, `${name}/${file} must call isServiceRoleRequest(req, …) in its handler`);
    for (const work of ['req.json(', 'createClient(']) {
      const at = source.indexOf(work, start);
      if (at >= 0) assert(guard < at, `${name}/${file}: the service-role check must run before ${work}`);
    }
  });
}

Deno.test('the service-role-only list names existing functions only', async () => {
  for (const name of SERVICE_ROLE_ONLY_FUNCTIONS) {
    const stat = await Deno.stat(new URL(`../${name}/index.ts`, import.meta.url));
    assertEquals(stat.isFile, true, `${name}/index.ts`);
  }
});
