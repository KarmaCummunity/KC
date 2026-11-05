// Organization events (G1 step 5, D31, S13; supabase/migrations/0563_event_posts.sql and
// 0564_event_attendance_waitlist.sql): register, approve / decline, cancel, mark attendance, the
// organizer's roster, the viewer's own registration and the organizations an organizer may
// publish an event for. Registrations are post handoffs, so an
// empty id fails with the same domain error as the other handoff use cases.
import type { IMarketplaceRepository } from '../ports/IMarketplaceRepository';
import {
  GivingHandoffError,
  type EventRegistration,
  type MyEventRegistration,
  type OrganizationMembershipOption,
} from '@kc/domain';

function isBlank(id: string): boolean {
  return !id || !id.trim();
}

/** Throws when the event's post / listing id is empty. */
function requireTarget(target: string): void {
  if (isBlank(target)) throw new GivingHandoffError('listing_not_available', 'Event id is required');
}

/** Throws when the registration's handoff id is empty. */
function requireHandoff(handoffId: string): void {
  if (isBlank(handoffId)) throw new GivingHandoffError('handoff_not_found', 'Registration id is required');
}

export class RegisterForEventUseCase {
  constructor(private readonly repo: IMarketplaceRepository) {}
  async execute(target: string): Promise<MyEventRegistration> {
    requireTarget(target);
    return this.repo.registerForEvent(target);
  }
}

export class DecideEventRegistrationUseCase {
  constructor(private readonly repo: IMarketplaceRepository) {}
  async execute(handoffId: string, approve: boolean): Promise<void> {
    requireHandoff(handoffId);
    await this.repo.decideEventRegistration(handoffId, approve);
  }
}

export class CancelEventRegistrationUseCase {
  constructor(private readonly repo: IMarketplaceRepository) {}
  async execute(handoffId: string): Promise<void> {
    requireHandoff(handoffId);
    await this.repo.cancelEventRegistration(handoffId);
  }
}

export class MarkEventAttendanceUseCase {
  constructor(private readonly repo: IMarketplaceRepository) {}
  /** `attended` true marks attendance (the attendee earns karma once); false marks an absence. */
  async execute(handoffId: string, attended: boolean): Promise<void> {
    requireHandoff(handoffId);
    await this.repo.markEventAttendance(handoffId, attended);
  }
}

export class ListEventRegistrationsUseCase {
  constructor(private readonly repo: IMarketplaceRepository) {}
  async execute(target: string): Promise<EventRegistration[]> {
    requireTarget(target);
    return this.repo.listEventRegistrations(target);
  }
}

export class GetMyEventRegistrationUseCase {
  constructor(private readonly repo: IMarketplaceRepository) {}
  /** No post yet (an unpublished event) means no registration, not an error. */
  async execute(postId: string): Promise<MyEventRegistration | null> {
    if (isBlank(postId)) return null;
    return this.repo.getMyEventRegistration(postId);
  }
}

export class ListMyOrganizationsUseCase {
  constructor(private readonly repo: IMarketplaceRepository) {}
  execute(): Promise<OrganizationMembershipOption[]> {
    return this.repo.listMyOrganizations();
  }
}
