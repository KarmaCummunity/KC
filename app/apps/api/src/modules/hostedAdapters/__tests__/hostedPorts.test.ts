import { describe, expect, it } from 'vitest';
import type { SqlBackedClient } from '../../../platform/postgrest/sqlBackedClient';
import { indexPorts } from '../../../platform/ports/portGateway.module';
import { HOSTED_PORTS } from '../hostedPorts';

/** Adapters only store the client in their constructor, so an inert one is enough to build them. */
const inertClient = {} as SqlBackedClient;

describe('hosted ports', () => {
  it('have unique wire names', () => {
    expect(indexPorts(HOSTED_PORTS).size).toBe(HOSTED_PORTS.length);
    expect(HOSTED_PORTS.length).toBeGreaterThanOrEqual(66);
  });

  it('follow the naming rule: a lower-camel-case port name without the Repository or Service suffix', () => {
    for (const port of HOSTED_PORTS) {
      expect(port.name).toMatch(/^[a-z][A-Za-z0-9]*$/);
      expect(port.name).not.toMatch(/(Repository|Service)$/);
    }
  });

  it.each(HOSTED_PORTS.map((port) => [port.name, port] as const))('%s: every listed method exists on its adapter', (_name, port) => {
    const implementation = port.create(inertClient) as Record<string, unknown>;
    const missing = Object.keys(port.methods).filter((method) => typeof implementation[method] !== 'function');

    expect(missing).toEqual([]);
  });

  it('open to signed-out visitors only the methods the database grants to the anon role', () => {
    const open = HOSTED_PORTS.flatMap((port) =>
      Object.entries(port.methods)
        .filter(([, access]) => access === 'public')
        .map(([method]) => `${port.name}.${method}`),
    ).sort();

    // A change here is a security decision: it must match a grant to `anon` in a migration.
    expect(open).toEqual([
      'guestPosts.get',
      'guestPosts.list',
      'kcSupportChannels.listActiveChannels',
      'orgTransparency.getPublic',
      'payments.getNonprofitPublicPage',
      'payments.listVerifiedNonprofits',
      'publicResearch.loadBundle',
      'stats.getActivePublicPostsCount',
      'stats.getCommunityStatsSnapshot',
      'worldContent.getWorldContent',
    ]);
  });

  it('do not serve the methods that need Storage or an Edge Function', () => {
    const notServed = HOSTED_PORTS.flatMap((port) =>
      Object.entries(port.methods)
        .filter(([, access]) => access === 'not_served')
        .map(([method]) => `${port.name}.${method}`),
    ).sort();

    expect(notServed).toEqual([
      'donationLinks.addViaEdgeFunction',
      'donationLinks.updateViaEdgeFunction',
      'post.republish',
      'publicResearch.submit',
    ]);
  });
});
