import { describe, expect, it } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { SupabaseFollowSuggestionsRepository } from '../SupabaseFollowSuggestionsRepository';

// M03 / M04: the baseline has neither a suggestion query nor a completeness function. The
// adapter reports both as missing without a call, so the screens degrade (empty list, no nudge).
describe('SupabaseFollowSuggestionsRepository (capabilities missing from the baseline)', () => {
  it('listSuggestions reports rpc_follow_suggestions as unavailable (M03)', async () => {
    const error = await new SupabaseFollowSuggestionsRepository().listSuggestions(20).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BackendUnavailableError);
    expect(error).toMatchObject({ object: 'rpc:rpc_follow_suggestions', kind: 'function' });
  });

  it('getProfileCompleteness reports rpc_profile_completeness as unavailable (M04)', async () => {
    const error = await new SupabaseFollowSuggestionsRepository().getProfileCompleteness().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BackendUnavailableError);
    expect(error).toMatchObject({ object: 'rpc:rpc_profile_completeness', kind: 'function' });
  });
});
