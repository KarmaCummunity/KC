import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOSTED_PORTS } from '../../modules/hostedAdapters/hostedPorts';
import { findArgsProblem, type PortArgShapes } from '../../platform/ports/argShapes';
import { errorCodeOf } from '../../platform/ports/portClients';
import generated from '../../platform/ports/portArgShapes.generated.json';
import type { SqlBackedClient } from '../../platform/postgrest/sqlBackedClient';
import { KC_DATABASE_URL, KcTestDatabase } from '../support/kcDatabase';
import { sampleArgs } from '../support/sampleArgs';

const shapes = generated as unknown as PortArgShapes;

/** One request an adapter made that the engine answered with an error. */
interface Refusal {
  readonly call: string;
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

/**
 * Codes that mean the engine, not the data, is at fault: a part of the
 * PostgREST dialect it does not implement, or SQL it built wrongly.
 */
const ENGINE_FAULTS = new Set(['PGRST100', 'PGRST102', '42601']);

/** Codes that mean an adapter names something the schema does not have, or the engine resolved it wrongly. */
const SCHEMA_MISMATCH = new Set(['42703', '42883', '42P01', '3F000', 'PGRST200', 'PGRST201', 'PGRST202', 'PGRST203', 'PGRST204', 'PGRST205']);

/** Functions of the dev-only seeds (demo data, production copy): on kc-dev, never in the migrations. */
const DEV_SEED_PATHS = new Set([
  '/rpc/admin_demo_data_status',
  '/rpc/admin_wipe_demo_data_step',
  '/rpc/admin_seed_demo_data_step',
  '/rpc/admin_prod_copy_status',
  '/rpc/admin_delete_prod_copy',
]);

/**
 * What a well-typed but meaningless call is expected to run into: a rule of
 * a function (P0001), no permission (42501), a constraint (class 23), a value
 * of the wrong form such as "sample" for a time or an enum (class 22), or no
 * row where one was asked for (PGRST116, or P0002 when a function looked for
 * the row itself, as the import functions do for an unknown import id).
 */
const DATA_REFUSALS = /^(P0001|P0002|42501|PGRST116|23\d{3}|22[0-9A-Z]{3})$/;

/**
 * Every served method of every hosted port, called once on the real KC
 * schema with well-typed sample arguments. Most calls are refused by the
 * database (nothing to act on, no permission, a rule) and that is fine: the
 * point is that the engine understood every request the adapters build.
 * It covers the ports that have no contract suite of their own.
 */
describe.skipIf(!KC_DATABASE_URL)('Every hosted port method on the compatibility engine', () => {
  const database = new KcTestDatabase();
  const refusals: Refusal[] = [];
  const crashes: Array<{ call: string; error: string }> = [];
  let calls = 0;

  beforeAll(async () => {
    const other = await database.newMember();
    for (const port of HOSTED_PORTS) {
      for (const [method, access] of Object.entries(port.methods)) {
        const parameters = shapes.ports[port.name]?.[method];
        if (access === 'not_served' || !parameters) continue;
        // A fresh member per call: a method that closes the account must not starve the next one.
        const member = await database.newMember();
        const call = `${port.name}.${method}`;
        const args = sampleArgs(parameters, shapes.types, { memberId: member.userId, otherMemberId: other.userId });
        if (findArgsProblem(args, parameters, shapes.types)) throw new Error(`the sample for ${call} does not match its own shape`);

        const client = database.clientFor<SqlBackedClient>(member.caller, (request, response) => {
          const code = errorCodeOf(response);
          if (!code) return;
          const { message } = JSON.parse(response.body ?? '{}') as { message?: string };
          refusals.push({ call, path: new URL(request.url).pathname.replace('/rest/v1', ''), code, message: message ?? '' });
        });
        const implementation = port.create(client) as Record<string, (...values: unknown[]) => Promise<unknown>>;
        calls += 1;
        try {
          await implementation[method]?.(...args);
        } catch (error) {
          // A crash is a failure that is not an Error the adapters raise on purpose (TypeError and the like).
          if (error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError) {
            crashes.push({ call, error: `${error.name}: ${error.message}` });
          }
        }
      }
    }
  }, 600_000);

  afterAll(async () => {
    await database.close();
  });

  it('called every served method', () => {
    expect(calls).toBeGreaterThan(340);
  });

  it('understood every request the adapters built', () => {
    const faults = refusals.filter((refusal) => ENGINE_FAULTS.has(refusal.code));

    expect(faults).toEqual([]);
  });

  it('ran no adapter into a crash: every failure was a refusal, not a TypeError', () => {
    expect(crashes).toEqual([]);
  });

  it('found no table, column, relationship or function the schema lacks', () => {
    const missing = refusals.filter(
      (refusal) => SCHEMA_MISMATCH.has(refusal.code) && !(refusal.code === 'PGRST202' && DEV_SEED_PATHS.has(refusal.path)),
    );

    expect(missing).toEqual([]);
  });

  it('was refused by the database only for reasons that depend on the data', () => {
    const unexpected = refusals.filter(
      (refusal) => !ENGINE_FAULTS.has(refusal.code) && !SCHEMA_MISMATCH.has(refusal.code) && !DATA_REFUSALS.test(refusal.code),
    );

    expect(unexpected).toEqual([]);
  });
});
