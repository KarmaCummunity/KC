// FR-HOUSING-003, 012, 015–020 — housing use cases guard inputs and delegate to the port.
import { describe, expect, it, vi } from 'vitest';
import { HousingError, type HousingHostBooking, type HousingStayRequestInput } from '@kc/domain';
import type { IHousingRepository } from '../../ports/IHousingRepository';
import {
  CancelHousingBookingUseCase,
  CompleteHousingStayUseCase,
  DecideHousingBookingUseCase,
  MarkHousingNoShowUseCase,
  RequestHousingStayUseCase,
} from '../housingBookingUseCases';
import { GetHousingConductStatusUseCase, SetHousingPrivateDetailsUseCase } from '../housingPlaceUseCases';

/** Typed fake: each method is a mock with the port's exact signature. */
function makeRepo() {
  return {
    currentConductVersion: vi.fn<IHousingRepository['currentConductVersion']>(async () => 2),
    hasAcceptedConduct: vi.fn<IHousingRepository['hasAcceptedConduct']>(async () => false),
    acceptConduct: vi.fn<IHousingRepository['acceptConduct']>(async () => undefined),
    requestStay: vi.fn<IHousingRepository['requestStay']>(async () => 'h1'),
    decide: vi.fn<IHousingRepository['decide']>(async () => undefined),
    cancel: vi.fn<IHousingRepository['cancel']>(async () => undefined),
    complete: vi.fn<IHousingRepository['complete']>(async () => undefined),
    markNoShow: vi.fn<IHousingRepository['markNoShow']>(async () => undefined),
    listForOffer: vi.fn<IHousingRepository['listForOffer']>(async () => []),
    listMyStays: vi.fn<IHousingRepository['listMyStays']>(async () => []),
    getPrivateDetails: vi.fn<IHousingRepository['getPrivateDetails']>(async () => null),
    setPrivateDetails: vi.fn<IHousingRepository['setPrivateDetails']>(async () => undefined),
  } satisfies IHousingRepository;
}

const TERMS = { minNights: 1, maxNights: 7, childrenOk: true, capacity: 2 };
const REQUEST: HousingStayRequestInput = {
  listingId: 'l1', checkInDate: '2030-03-12', checkOutDate: '2030-03-14', adults: 1, minors: 0,
  message: '  Hi, walking the trail  ', minorsGuardianAck: false,
};
const BOOKING: HousingHostBooking = {
  handoffId: 'h1', guestId: 'g1', guestName: 'Guest', guestAvatarUrl: null, guestVerified: true,
  guestCompletedStays: 1, guestMemberSince: '2029-01-01T00:00:00Z', adults: 1, minors: 0, message: 'hi',
  status: 'confirmed', reservedAt: '2030-03-10T10:00:00Z', confirmBy: null, ratedByMe: false,
  checkInDate: '2030-03-12', checkOutDate: '2030-03-14',
  startsAt: '2030-03-12T14:00:00.000Z', endsAt: '2030-03-14T08:00:00.000Z',
};

describe('RequestHousingStayUseCase', () => {
  it('sends a valid request with a trimmed message', async () => {
    const repo = makeRepo();
    await expect(new RequestHousingStayUseCase(repo).execute(REQUEST, TERMS, '2030-03-10')).resolves.toBe('h1');
    expect(repo.requestStay).toHaveBeenCalledWith({ ...REQUEST, message: 'Hi, walking the trail' });
  });
  it('refuses a request the rules reject, without calling the server', async () => {
    const repo = makeRepo();
    await expect(new RequestHousingStayUseCase(repo).execute({ ...REQUEST, adults: 3 }, TERMS, '2030-03-10'))
      .rejects.toMatchObject({ code: 'housing_capacity_exceeded' });
    expect(repo.requestStay).not.toHaveBeenCalled();
  });
});

describe('DecideHousingBookingUseCase', () => {
  it('decides a waiting booking with a normalized note', async () => {
    const repo = makeRepo();
    await new DecideHousingBookingUseCase(repo).execute({ ...BOOKING, status: 'reserved' }, false, '   ');
    expect(repo.decide).toHaveBeenCalledWith('h1', false, null);
  });
  it('refuses a booking that is no longer waiting, and an over-long note', async () => {
    const useCase = new DecideHousingBookingUseCase(makeRepo());
    await expect(useCase.execute(BOOKING, true)).rejects.toBeInstanceOf(HousingError);
    await expect(useCase.execute({ ...BOOKING, status: 'reserved' }, true, 'x'.repeat(301)))
      .rejects.toMatchObject({ code: 'housing_note_too_long' });
  });
});

describe('CancelHousingBookingUseCase', () => {
  it('a guest cancels without a reason', async () => {
    const repo = makeRepo();
    await new CancelHousingBookingUseCase(repo).execute('h1', 'guest', 'confirmed');
    expect(repo.cancel).toHaveBeenCalledWith('h1', null);
  });
  it('a host cancelling a confirmed stay must give a reason', async () => {
    const repo = makeRepo();
    await expect(new CancelHousingBookingUseCase(repo).execute('h1', 'host', 'confirmed', ' '))
      .rejects.toMatchObject({ code: 'housing_cancel_reason_required' });
    await new CancelHousingBookingUseCase(repo).execute('h1', 'host', 'confirmed', 'Family emergency');
    expect(repo.cancel).toHaveBeenCalledWith('h1', 'Family emergency');
  });
});

describe('completion and no-show windows', () => {
  it('completes from check-in on and refuses before it', async () => {
    const repo = makeRepo();
    await expect(new CompleteHousingStayUseCase(repo).execute(BOOKING, new Date('2030-03-12T10:00:00Z')))
      .rejects.toMatchObject({ code: 'housing_not_in_window' });
    await new CompleteHousingStayUseCase(repo).execute(BOOKING, new Date('2030-03-13T10:00:00Z'));
    expect(repo.complete).toHaveBeenCalledWith('h1');
  });
  it('marks a no-show only between 3 h and 24 h after check-in', async () => {
    const repo = makeRepo();
    await expect(new MarkHousingNoShowUseCase(repo).execute(BOOKING, new Date('2030-03-12T15:00:00Z')))
      .rejects.toMatchObject({ code: 'housing_not_in_window' });
    await new MarkHousingNoShowUseCase(repo).execute(BOOKING, new Date('2030-03-12T18:00:00Z'));
    expect(repo.markNoShow).toHaveBeenCalledWith('h1');
  });
});

describe('conduct and place', () => {
  it('reports the current version and whether it is accepted', async () => {
    await expect(new GetHousingConductStatusUseCase(makeRepo()).execute()).resolves.toEqual({ version: 2, accepted: false });
  });
  it('trims the place and clears blank notes', async () => {
    const repo = makeRepo();
    await new SetHousingPrivateDetailsUseCase(repo).execute({
      listingId: 'l1', streetId: 7, houseNumber: ' 12 ', entranceNotes: '  ', accessInstructions: ' Key box ',
    });
    expect(repo.setPrivateDetails).toHaveBeenCalledWith(expect.objectContaining({
      houseNumber: '12', entranceNotes: null, accessInstructions: 'Key box',
    }));
  });
});
