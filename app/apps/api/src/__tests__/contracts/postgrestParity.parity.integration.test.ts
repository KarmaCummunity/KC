import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOSTED_PORTS } from '../../modules/hostedAdapters/hostedPorts';
import type { PortArgShapes } from '../../platform/ports/argShapes';
import generated from '../../platform/ports/portArgShapes.generated.json';
import type { SqlBackedClient } from '../../platform/postgrest/sqlBackedClient';
import { KcTestDatabase, type TestMember } from '../support/kcDatabase';
import { engineExchange, type Exchange, inComparableOrder, postgrestClientFor, type PostgrestTarget, type RecordedClient, withBodyShapesOnly } from '../support/postgrestParity';
import { sampleArgs } from '../support/sampleArgs';

const shapes = generated as unknown as PortArgShapes;
const TARGET: PostgrestTarget = {
  url: process.env.KC_API_TEST_POSTGREST_URL as string,
  anonKey: process.env.KC_API_TEST_POSTGREST_ANON_KEY as string,
  jwtSecret: process.env.KC_API_TEST_POSTGREST_JWT_SECRET as string,
};

type Implementation = Record<string, (...values: unknown[]) => Promise<unknown>>;
interface Difference {
  readonly call: string;
  readonly engine: readonly Exchange[];
  readonly postgrest: readonly Exchange[];
}

/**
 * Methods whose answer ranks every member in the database: two members never
 * see the same list, so the two runs are compared by the shape of what came
 * back (the keys and types of every row), not by its values.
 */
const RANKS_EVERY_MEMBER = new Set(['followSuggestions.listSuggestions']);

/**
 * The compatibility engine exists to answer exactly as PostgREST does
 * (ADR-010). Here every served method of every hosted port is called twice
 * with the same sample arguments, by two fresh members in the same state:
 * once on the engine and once on a real PostgREST over the same database.
 * A method visitors may call is compared once more without a caller.
 * Each request the adapter made must have been answered alike: the same
 * status, the same `Content-Range`, the same body, the same error code and
 * text. Collected only when KC_API_TEST_POSTGREST_URL names a PostgREST
 * (vitest.config.ts); the backend CI lane runs it on the local stack.
 */
describe('The compatibility engine against a real PostgREST', () => {
  const database = new KcTestDatabase(process.env.KC_API_TEST_POSTGREST_DATABASE_URL);
  const differences: Difference[] = [];
  let calls = 0;
  let visitorCalls = 0;

  /**
   * Runs one method on the client `clientOf` builds and returns what was exchanged.
   * @param asVisitor Without a signed-in caller; otherwise as a fresh member.
   */
  async function exchangesOf(
    port: (typeof HOSTED_PORTS)[number],
    method: string,
    asVisitor: boolean,
    clientOf: (member: TestMember | null, record: (exchange: Exchange) => void) => Promise<RecordedClient>,
  ): Promise<Exchange[]> {
    // The smaller id acts: a pair of members is stored in id order, and both runs must see the same order.
    const [first, other] = [await database.newMember(), await database.newMember()].sort((a, b) => a.userId.localeCompare(b.userId)) as [TestMember, TestMember];
    const member = asVisitor ? null : first;
    const exchanges: Exchange[] = [];
    const { client, settled } = await clientOf(member, (exchange) => exchanges.push(exchange));
    const parameters = shapes.ports[port.name]?.[method] ?? [];
    const args = sampleArgs(parameters, shapes.types, { memberId: first.userId, otherMemberId: other.userId });
    await (port.create(client) as Implementation)[method]?.(...args).catch(() => undefined);
    // A method that asked several things at once and failed on one returns before the others are answered.
    await settled();
    return inComparableOrder(exchanges);
  }

  /** Runs one method on the engine and on PostgREST, and keeps the pair when they were not answered alike. */
  async function compare(port: (typeof HOSTED_PORTS)[number], method: string, asVisitor: boolean): Promise<void> {
    const engine = await exchangesOf(port, method, asVisitor, (member, record) =>
      Promise.resolve({
        client: database.clientFor<SqlBackedClient>(member?.caller ?? null, (request, response) => record(engineExchange(request, response, member))),
        settled: () => database.settled(),
      }),
    );
    const postgrest = await exchangesOf(port, method, asVisitor, (member, record) => postgrestClientFor(member, TARGET, record));
    const call = `${port.name}.${method}${asVisitor ? ' (visitor)' : ''}`;
    const comparable = RANKS_EVERY_MEMBER.has(`${port.name}.${method}`) ? withBodyShapesOnly : (exchanges: Exchange[]) => exchanges;
    if (JSON.stringify(comparable(engine)) !== JSON.stringify(comparable(postgrest))) differences.push({ call, engine, postgrest });
  }

  beforeAll(async () => {
    for (const port of HOSTED_PORTS) {
      for (const [method, access] of Object.entries(port.methods)) {
        if (access === 'not_served' || access === 'member_with_files' || !shapes.ports[port.name]?.[method]) continue;
        calls += 1;
        await compare(port, method, false);
        // What a visitor may call, a visitor calls too: a refusal must read "sign in" on both.
        if (access === 'public') {
          visitorCalls += 1;
          await compare(port, method, true);
        }
      }
    }
  }, 900_000);

  afterAll(async () => {
    await database.close();
  });

  it('called every served method on both, and every public one also as a visitor', () => {
    expect(calls).toBeGreaterThan(340);
    expect(visitorCalls).toBeGreaterThan(5);
  });

  it('answered every request as PostgREST does', () => {
    expect(differences).toEqual([]);
  });
});
