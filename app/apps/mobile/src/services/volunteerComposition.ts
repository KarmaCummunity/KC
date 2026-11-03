import {
  SupabaseVolunteerRepository,
  getSupabaseClient,
} from '@kc/infrastructure-supabase';
import {
  AddVolunteerShiftUseCase,
  CancelVolunteerSignupUseCase,
  CheckInVolunteerShiftUseCase,
  CloseVolunteerOpportunityUseCase,
  CreateVolunteerOpportunityUseCase,
  GetVolunteerOpportunityDetailUseCase,
  GetVolunteerShiftIcsUseCase,
  ListMyOrganizerVolunteerOpportunitiesUseCase,
  ListMyVolunteerSignupsUseCase,
  ListShiftVolunteersUseCase,
  ListVolunteerOpportunitiesUseCase,
  OrganizerMessageShiftVolunteersUseCase,
  PublishVolunteerOpportunityUseCase,
  SignUpVolunteerShiftUseCase,
} from '@kc/application';
import { pickAuthStorage } from './authSecureStorage';

let _repo: SupabaseVolunteerRepository | null = null;

function repo() {
  _repo ??= new SupabaseVolunteerRepository(getSupabaseClient({ storage: pickAuthStorage() }));
  return _repo;
}

export const volunteerUseCases = {
  listOpportunities: () => new ListVolunteerOpportunitiesUseCase(repo()),
  getDetail: () => new GetVolunteerOpportunityDetailUseCase(repo()),
  signUp: () => new SignUpVolunteerShiftUseCase(repo()),
  cancelSignup: () => new CancelVolunteerSignupUseCase(repo()),
  listMySignups: () => new ListMyVolunteerSignupsUseCase(repo()),
  checkIn: () => new CheckInVolunteerShiftUseCase(repo()),
  getIcs: () => new GetVolunteerShiftIcsUseCase(repo()),
  createOpportunity: () => new CreateVolunteerOpportunityUseCase(repo()),
  addShift: () => new AddVolunteerShiftUseCase(repo()),
  publish: () => new PublishVolunteerOpportunityUseCase(repo()),
  close: () => new CloseVolunteerOpportunityUseCase(repo()),
  listOrganizer: () => new ListMyOrganizerVolunteerOpportunitiesUseCase(repo()),
  listRoster: () => new ListShiftVolunteersUseCase(repo()),
  messageVolunteers: () => new OrganizerMessageShiftVolunteersUseCase(repo()),
};
