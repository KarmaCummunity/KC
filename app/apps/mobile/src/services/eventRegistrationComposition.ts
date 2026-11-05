// Composition root for organization events (G1 step 5, D31, S13): registration and the waitlist,
// the organizer's roster and attendance, and the organizations a member may publish an event for.
// Same adapter as the other listing flows.
import {
  CancelEventRegistrationUseCase,
  DecideEventRegistrationUseCase,
  GetMyEventRegistrationUseCase,
  ListEventRegistrationsUseCase,
  ListMyOrganizationsUseCase,
  MarkEventAttendanceUseCase,
  RegisterForEventUseCase,
} from '@kc/application';
import { marketplaceRepository } from './marketplaceComposition';

export const eventRegistrationUseCases = {
  register: () => new RegisterForEventUseCase(marketplaceRepository()),
  decide: () => new DecideEventRegistrationUseCase(marketplaceRepository()),
  cancel: () => new CancelEventRegistrationUseCase(marketplaceRepository()),
  markAttendance: () => new MarkEventAttendanceUseCase(marketplaceRepository()),
  listForEvent: () => new ListEventRegistrationsUseCase(marketplaceRepository()),
  getMine: () => new GetMyEventRegistrationUseCase(marketplaceRepository()),
  listMyOrganizations: () => new ListMyOrganizationsUseCase(marketplaceRepository()),
};

/** React Query key of the viewer's own registration to an event post. */
export const myEventRegistrationQueryKey = (postId: string) => ['event-registration', 'mine', postId] as const;

/** React Query key of an event post's roster (organizer view). */
export const eventRosterQueryKey = (postId: string) => ['event-registration', 'roster', postId] as const;

/** React Query key of the signed-in member's organizations (the event form's picker). */
export const MY_ORGANIZATIONS_QUERY_KEY = ['my-organizations'] as const;
