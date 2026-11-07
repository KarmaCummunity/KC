import { describe, it, expect, vi } from 'vitest';
import type { IVolunteerRepository } from '../../ports/IVolunteerRepository';
import {
  CancelVolunteerSignupUseCase,
  CheckInVolunteerShiftUseCase,
  CloseVolunteerOpportunityUseCase,
  GetVolunteerOpportunityDetailUseCase,
  GetVolunteerShiftIcsUseCase,
  ListMyOrganizerVolunteerOpportunitiesUseCase,
  ListMyVolunteerSignupsUseCase,
  ListShiftVolunteersUseCase,
  ListVolunteerOpportunitiesUseCase,
  OrganizerMessageShiftVolunteersUseCase,
  SignUpVolunteerShiftUseCase,
} from '../volunteerUseCases';

function makeRepo() {
  return {
    listOpportunities: vi.fn(async () => []),
    getOpportunityDetail: vi.fn(async () => null),
    signUpForShift: vi.fn(async () => ({ signupId: 's1', status: 'registered' })),
    cancelSignup: vi.fn(async () => undefined),
    listMySignups: vi.fn(async () => []),
    checkIn: vi.fn(async () => ({ hoursLogged: 2, karmaPoints: 2 })),
    getShiftIcs: vi.fn(async () => 'BEGIN:VCALENDAR'),
    closeOpportunity: vi.fn(async () => undefined),
    listMyOrganizerOpportunities: vi.fn(async () => []),
    listShiftVolunteers: vi.fn(async () => []),
    messageShiftVolunteers: vi.fn(async () => 3),
  } satisfies IVolunteerRepository;
}

describe('volunteer use cases', () => {
  it('delegate reads to the repository', async () => {
    const repo = makeRepo();
    expect(await new ListVolunteerOpportunitiesUseCase(repo).execute(10, 5)).toEqual([]);
    expect(repo.listOpportunities).toHaveBeenCalledWith(10, 5);
    expect(await new GetVolunteerOpportunityDetailUseCase(repo).execute('opp1')).toBeNull();
    expect(repo.getOpportunityDetail).toHaveBeenCalledWith('opp1');
    expect(await new ListMyVolunteerSignupsUseCase(repo).execute(7)).toEqual([]);
    expect(repo.listMySignups).toHaveBeenCalledWith(7);
    expect(await new GetVolunteerShiftIcsUseCase(repo).execute('shift1')).toBe('BEGIN:VCALENDAR');
    expect(await new ListMyOrganizerVolunteerOpportunitiesUseCase(repo).execute(4)).toEqual([]);
    expect(repo.listMyOrganizerOpportunities).toHaveBeenCalledWith(4);
    expect(await new ListShiftVolunteersUseCase(repo).execute('shift1')).toEqual([]);
    expect(repo.listShiftVolunteers).toHaveBeenCalledWith('shift1');
  });

  it('delegate volunteer actions to the repository', async () => {
    const repo = makeRepo();
    expect(await new SignUpVolunteerShiftUseCase(repo).execute('shift1')).toEqual({
      signupId: 's1',
      status: 'registered',
    });
    await new CancelVolunteerSignupUseCase(repo).execute('s1');
    expect(repo.cancelSignup).toHaveBeenCalledWith('s1');
    expect(await new CheckInVolunteerShiftUseCase(repo).execute('s1')).toEqual({
      hoursLogged: 2,
      karmaPoints: 2,
    });
  });

  it('delegate organizer actions to the repository', async () => {
    const repo = makeRepo();
    await new CloseVolunteerOpportunityUseCase(repo).execute('opp1');
    expect(repo.closeOpportunity).toHaveBeenCalledWith('opp1');
    expect(await new OrganizerMessageShiftVolunteersUseCase(repo).execute('shift1', 'hi')).toBe(3);
    expect(repo.messageShiftVolunteers).toHaveBeenCalledWith('shift1', 'hi');
  });
});
