// G1 step 5 (D31, 0563) — organization event use cases delegate to the marketplace repository and
// refuse an empty event or registration id with a domain error before any I/O.
import { describe, it, expect, vi } from 'vitest';
import type { IMarketplaceRepository } from '../../ports/IMarketplaceRepository';
import { GivingHandoffError } from '@kc/domain';
import {
  CancelEventRegistrationUseCase,
  DecideEventRegistrationUseCase,
  GetMyEventRegistrationUseCase,
  ListEventRegistrationsUseCase,
  ListMyOrganizationsUseCase,
  MarkEventAttendanceUseCase,
  RegisterForEventUseCase,
} from '../eventRegistrationUseCases';

const mine = { handoffId: 'h1', status: 'confirmed', reservedAt: '2026-11-01T00:00:00Z', confirmedAt: null };
const orgs = [{ orgId: 'o1', name: 'Food bank' }];

function makeRepo() {
  const repo = {
    registerForEvent: vi.fn(async () => mine),
    decideEventRegistration: vi.fn(async () => undefined),
    cancelEventRegistration: vi.fn(async () => undefined),
    markEventAttendance: vi.fn(async () => undefined),
    listEventRegistrations: vi.fn(async () => []),
    getMyEventRegistration: vi.fn(async () => mine),
    listMyOrganizations: vi.fn(async () => orgs),
  };
  return { repo, port: repo as unknown as IMarketplaceRepository };
}

describe('event registration use cases', () => {
  it('delegate to the marketplace repository on valid input', async () => {
    const { repo, port } = makeRepo();
    expect(await new RegisterForEventUseCase(port).execute('p1')).toBe(mine);
    expect(repo.registerForEvent).toHaveBeenCalledWith('p1');
    await new DecideEventRegistrationUseCase(port).execute('h1', false);
    expect(repo.decideEventRegistration).toHaveBeenCalledWith('h1', false);
    await new CancelEventRegistrationUseCase(port).execute('h1');
    expect(repo.cancelEventRegistration).toHaveBeenCalledWith('h1');
    await new MarkEventAttendanceUseCase(port).execute('h1', true);
    expect(repo.markEventAttendance).toHaveBeenCalledWith('h1', true);
    expect(await new ListEventRegistrationsUseCase(port).execute('p1')).toEqual([]);
    expect(repo.listEventRegistrations).toHaveBeenCalledWith('p1');
    expect(await new GetMyEventRegistrationUseCase(port).execute('p1')).toBe(mine);
    expect(await new ListMyOrganizationsUseCase(port).execute()).toBe(orgs);
  });

  it('refuse an empty event or registration id without calling the server', async () => {
    const { repo, port } = makeRepo();
    await expect(new RegisterForEventUseCase(port).execute(' ')).rejects.toBeInstanceOf(GivingHandoffError);
    await expect(new ListEventRegistrationsUseCase(port).execute('')).rejects.toMatchObject({ code: 'listing_not_available' });
    await expect(new DecideEventRegistrationUseCase(port).execute('', true)).rejects.toMatchObject({ code: 'handoff_not_found' });
    await expect(new CancelEventRegistrationUseCase(port).execute(' ')).rejects.toMatchObject({ code: 'handoff_not_found' });
    expect(repo.registerForEvent).not.toHaveBeenCalled();
    expect(repo.decideEventRegistration).not.toHaveBeenCalled();
    expect(repo.cancelEventRegistration).not.toHaveBeenCalled();
    await expect(new MarkEventAttendanceUseCase(port).execute('', false)).rejects.toMatchObject({ code: 'handoff_not_found' });
    expect(repo.markEventAttendance).not.toHaveBeenCalled();
  });

  it('reads no registration for an event without a post yet', async () => {
    const { repo, port } = makeRepo();
    expect(await new GetMyEventRegistrationUseCase(port).execute('')).toBeNull();
    expect(repo.getMyEventRegistration).not.toHaveBeenCalled();
  });
});
