import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { IdentityDatabase } from '../../platform/database/identityDatabase';
import { AuthenticatedGuard } from '../../platform/identity/authenticated.guard';
import { Caller } from '../../platform/identity/caller.decorator';
import type { CallerIdentity } from '../../platform/identity/callerIdentity';

/** Body of `GET /v1/session`. */
export interface SessionBody {
  readonly userId: string;
}

/** The database did not resolve the caller the token proved. */
export class SessionIdentityError extends Error {
  constructor() {
    super('the database resolved a different caller than the access token');
    this.name = 'SessionIdentityError';
  }
}

@Controller('session')
@UseGuards(AuthenticatedGuard)
export class SessionController {
  constructor(@Inject(IdentityDatabase) private readonly database: IdentityDatabase) {}

  /**
   * Who the backend says the caller is. The id is read back from the database
   * (`auth.uid()` inside the caller's transaction), not copied from the token:
   * a client that gets its own id here knows RLS will see it as that user.
   */
  @Get()
  async current(@Caller() caller: CallerIdentity): Promise<SessionBody> {
    const resolved = await this.database.runAs(caller, async (session) => {
      const result = await session.query<{ user_id: string | null }>('select auth.uid() as user_id');
      return result.rows[0]?.user_id ?? null;
    });
    // A mismatch means the identity bridge is broken; never answer with a guess.
    if (resolved !== caller.userId) throw new SessionIdentityError();
    return { userId: resolved };
  }
}
