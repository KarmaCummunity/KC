// Composition of the staff moderation and support tools restored at the baseline (FR-ADMIN-013,
// FR-MOD-002, FR-MOD-008), kept out of container.ts for the 300-line cap; the container spreads
// the result, like the finance one.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type Database,
  SupabaseModerationAdminRepository,
  SupabaseModerationQueueRepository,
  SupabaseSupportInboxRepository,
} from '@kc/infrastructure-supabase';
import {
  AssignQueueEntryUseCase,
  JoinSupportThreadUseCase,
  ListModerationQueueUseCase,
  ListSupportThreadsUseCase,
  OpenMemberSupportThreadUseCase,
  RemoveCommentUseCase,
  ResolveQueueEntryUseCase,
} from '@kc/application';
import { viaApi } from '../services/backend/apiBackend';

export function createModerationStaffUseCases(supabase: SupabaseClient<Database>) {
  const supportInbox = viaApi('supportInbox', new SupabaseSupportInboxRepository(supabase));
  const moderationQueue = viaApi('moderationQueue', new SupabaseModerationQueueRepository(supabase));
  return {
    removeComment: new RemoveCommentUseCase(viaApi('moderationAdmin', new SupabaseModerationAdminRepository(supabase))),
    listSupportThreads: new ListSupportThreadsUseCase(supportInbox),
    joinSupportThread: new JoinSupportThreadUseCase(supportInbox),
    openMemberSupportThread: new OpenMemberSupportThreadUseCase(supportInbox),
    listModerationQueue: new ListModerationQueueUseCase(moderationQueue),
    assignQueueEntry: new AssignQueueEntryUseCase(moderationQueue),
    resolveQueueEntry: new ResolveQueueEntryUseCase(moderationQueue),
  };
}
