// _shared/serviceRoleGuard.test.ts — run: deno test --allow-read (from supabase/functions)
import { assert, assertEquals, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { isServiceRoleRequest, SERVICE_ROLE_ONLY_FUNCTIONS } from './serviceRoleGuard.ts';

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
    const start = Math.max(source.indexOf('serve('), 0);
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
