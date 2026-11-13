// Composition of the back-office use cases: staff timesheets (FR-ADMIN-033) and CRM contacts per
// organization (FR-ADMIN-032), kept out of container.ts for the 300-line cap; the container
// spreads the result, like the finance and WhatsApp admin ones.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type Database,
  SupabaseCrmContactsRepository,
  SupabaseTimesheetsRepository,
} from '@kc/infrastructure-supabase';
import {
  ApproveTimesheetUseCase,
  DeleteCrmContactUseCase,
  DeleteTimesheetUseCase,
  ListCrmContactsUseCase,
  ListCrmOrgsUseCase,
  ListTimesheetsUseCase,
  MarkCrmContactContactedUseCase,
  RejectTimesheetUseCase,
  SubmitTimesheetUseCase,
  UpsertCrmContactUseCase,
  UpsertTimesheetUseCase,
} from '@kc/application';

export function createBackOfficeUseCases(supabase: SupabaseClient<Database>) {
  const timesheets = new SupabaseTimesheetsRepository(supabase);
  const crmContacts = new SupabaseCrmContactsRepository(supabase);
  return {
    // FR-ADMIN-033
    listTimesheets: new ListTimesheetsUseCase(timesheets),
    upsertTimesheet: new UpsertTimesheetUseCase(timesheets),
    submitTimesheet: new SubmitTimesheetUseCase(timesheets),
    approveTimesheet: new ApproveTimesheetUseCase(timesheets),
    rejectTimesheet: new RejectTimesheetUseCase(timesheets),
    deleteTimesheet: new DeleteTimesheetUseCase(timesheets),
    // FR-ADMIN-032
    listCrmOrgs: new ListCrmOrgsUseCase(crmContacts),
    listCrmContacts: new ListCrmContactsUseCase(crmContacts),
    upsertCrmContact: new UpsertCrmContactUseCase(crmContacts),
    deleteCrmContact: new DeleteCrmContactUseCase(crmContacts),
    markCrmContactContacted: new MarkCrmContactContactedUseCase(crmContacts),
  };
}
