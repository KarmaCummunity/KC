// Seeded, signed-in users for the port contract suites (G39, D-204). Shared by the
// per-area harnesses (posts, chat); imported only from __tests__ files.
//
// Credentials come from the environment only — SUPABASE_URL, SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY — never from literals in the repo. ci-backend exports
// them from `supabase status -o env` after `supabase start`; locally:
//   eval "$(supabase status -o env)"
//   SUPABASE_URL=$API_URL SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \
//     pnpm --filter @kc/infrastructure-supabase test contract.integration
// Without them vitest.config.ts does not collect the contract suites at all.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createIntegrationClient } from './integrationSupabaseClient';

const PASSWORD = 'contract-p4ssword!!';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`contract harness: ${name} is not set — export the running stack with \`supabase status -o env\``);
  }
  return value;
}

export interface ContractUser {
  readonly userId: string;
  readonly displayName: string;
  /**
   * Signed in through the anon key, so RLS applies exactly as in the app. Untyped (`any` schema)
   * because the suites that share this harness address the baseline and, until their package
   * moves, the old schema.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly client: SupabaseClient<any>;
}

/** Creates confirmed, active members on the stack and deletes them on teardown. */
export class ContractUsers {
  private readonly url = requireEnv('SUPABASE_URL');
  private readonly anonKey = requireEnv('SUPABASE_ANON_KEY');
  /** Service-role client for seeding and lookups the actors themselves may not make. */
  readonly admin = createIntegrationClient(this.url, requireEnv('SUPABASE_SERVICE_ROLE_KEY'));
  private readonly cleanup: Array<() => Promise<void>> = [];

  async signInNewUser(): Promise<ContractUser> {
    const tag = crypto.randomUUID().slice(0, 8);
    const email = `contract-${tag}@kc.test`;
    const { data, error } = await this.admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`contract harness: createUser failed (${error?.message})`);
    const userId = data.user.id;
    // Deleting the auth user cascades to public.users and the actor's rows.
    this.cleanup.push(async () => {
      await this.admin.auth.admin.deleteUser(userId);
    });
    // The on_auth_user_created trigger created the member rows and, for a confirmed email,
    // an `active` user_account (insert policies of posts and chats require it). A per-user
    // display name lets cases check counterpart data.
    const displayName = `contract ${tag}`;
    const { error: profileError } = await this.admin
      .from('users')
      .update({ display_name: displayName })
      .eq('id', userId);
    if (profileError) throw new Error(`contract harness: profile update failed (${profileError.message})`);

    const client = createIntegrationClient(this.url, this.anonKey);
    const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (signInError) throw new Error(`contract harness: sign-in failed (${signInError.message})`);
    return { userId, displayName, client };
  }

  async teardown(): Promise<void> {
    for (const fn of this.cleanup.reverse()) {
      await fn().catch(() => undefined);
    }
  }
}
