import { describe, expect, it } from 'vitest';
import { DecideRideJoinUseCase } from '../DecideRideJoinUseCase';
import { FakeRideParticipantRepository } from './fakeRideParticipantRepository';

async function seedRequest(repo: FakeRideParticipantRepository, seats: number | null = 2) {
  repo.seedRide({
    rideId: 'r1',
    ownerId: 'u_owner',
    status: 'open',
    visibility: 'Public',
    seatsAvailable: seats,
  });
  repo.setCaller('u_rider');
  const requested = await repo.request({ rideId: 'r1', note: null });
  repo.setCaller('u_owner');
  return requested;
}

describe('DecideRideJoinUseCase', () => {
  it('approves a pending request', async () => {
    const repo = new FakeRideParticipantRepository();
    const requested = await seedRequest(repo);
    const uc = new DecideRideJoinUseCase(repo);

    const out = await uc.execute({ participantId: requested.participantId, status: 'approved' });

    expect(out.status).toBe('approved');
    expect(out.decidedBy).toBe('u_owner');
    expect(out.decidedAt).not.toBeNull();
  });

  it('rejects a pending request', async () => {
    const repo = new FakeRideParticipantRepository();
    const requested = await seedRequest(repo);
    const uc = new DecideRideJoinUseCase(repo);

    const out = await uc.execute({ participantId: requested.participantId, status: 'rejected' });

    expect(out.status).toBe('rejected');
  });

  it('throws invalid_status before reaching the repo', async () => {
    const repo = new FakeRideParticipantRepository();
    const uc = new DecideRideJoinUseCase(repo);
    await expect(
      uc.execute({ participantId: 'whatever', status: 'cancelled' as 'approved' }),
    ).rejects.toMatchObject({ code: 'invalid_status' });
  });

  it('propagates not_ride_owner when caller is not the owner', async () => {
    const repo = new FakeRideParticipantRepository();
    const requested = await seedRequest(repo);
    repo.setCaller('u_intruder');
    const uc = new DecideRideJoinUseCase(repo);

    await expect(
      uc.execute({ participantId: requested.participantId, status: 'approved' }),
    ).rejects.toMatchObject({ code: 'not_ride_owner' });
  });

  it('refuses second decide on a non-pending row', async () => {
    const repo = new FakeRideParticipantRepository();
    const requested = await seedRequest(repo);
    const uc = new DecideRideJoinUseCase(repo);
    await uc.execute({ participantId: requested.participantId, status: 'approved' });

    await expect(
      uc.execute({ participantId: requested.participantId, status: 'rejected' }),
    ).rejects.toMatchObject({ code: 'participant_not_pending' });
  });

  it('enforces ride_full when seat cap is reached', async () => {
    const repo = new FakeRideParticipantRepository();
    repo.seedRide({
      rideId: 'r1',
      ownerId: 'u_owner',
      status: 'open',
      visibility: 'Public',
      seatsAvailable: 1,
    });
    repo.setCaller('u_a');
    const reqA = await repo.request({ rideId: 'r1', note: null });
    repo.setCaller('u_b');
    const reqB = await repo.request({ rideId: 'r1', note: null });

    repo.setCaller('u_owner');
    const uc = new DecideRideJoinUseCase(repo);
    await uc.execute({ participantId: reqA.participantId, status: 'approved' });

    await expect(
      uc.execute({ participantId: reqB.participantId, status: 'approved' }),
    ).rejects.toMatchObject({ code: 'ride_full' });
  });

  it('treats null seats (request mode) as no cap', async () => {
    const repo = new FakeRideParticipantRepository();
    await seedRequest(repo, null);
    repo.setCaller('u_other');
    const second = await repo.request({ rideId: 'r1', note: null });

    repo.setCaller('u_owner');
    const uc = new DecideRideJoinUseCase(repo);
    await expect(
      uc.execute({ participantId: second.participantId, status: 'approved' }),
    ).resolves.toMatchObject({ status: 'approved' });
  });
});
