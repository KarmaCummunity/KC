// Local-stack harness for the posts-area port contracts (G39): IPostRepository and
// ISavedPostsRepository. Imported only by the *.contract.integration.test.ts files
// beside it (kept out of the main bundle by the __tests__ location). Seeding,
// sign-in and the credential contract live in ../../__tests__/contractUsers.ts.

import type { Address } from '@kc/domain';
import type { PostRepositoryActor, SavedPostsActor } from '@kc/application';
import { ContractUsers } from '../../__tests__/contractUsers';
import { SupabasePostRepository } from '../SupabasePostRepository';
import { SupabaseSavedPostsRepository } from '../SupabaseSavedPostsRepository';

/** Seeds users on the stack and hands out repositories bound to one signed-in client per actor. */
export class PostContractHarness {
  private readonly users = new ContractUsers();

  /** The first seeded city: the contract only needs an address the FK accepts. */
  async anyAddress(): Promise<Address> {
    const { data, error } = await this.users.admin.from('cities').select('city_id, name_he').limit(1).single();
    if (error || !data) throw new Error(`contract harness: no city on the stack (${error?.message ?? 'empty'})`);
    return { city: data.city_id, cityName: data.name_he, street: 'Contract St', streetNumber: '1' };
  }

  /** IPostRepository actor: a new user with a post repository acting as that user. */
  async newActor(): Promise<PostRepositoryActor> {
    const { userId, client } = await this.users.signInNewUser();
    return { userId, repo: new SupabasePostRepository(client) };
  }

  /** ISavedPostsRepository actor: the same signed-in client behind both repositories. */
  async newSavedPostsActor(): Promise<SavedPostsActor> {
    const { userId, client } = await this.users.signInNewUser();
    return {
      userId,
      posts: new SupabasePostRepository(client),
      saved: new SupabaseSavedPostsRepository(client),
    };
  }

  async teardown(): Promise<void> {
    await this.users.teardown();
  }
}
