import { Inject, Injectable } from '@nestjs/common';
import { submitDonationLink } from '../../modules/donationLinks/donationLinkService';
import { createSqlLinkStore } from '../../modules/donationLinks/sqlLinkStore';
import type { CallerIdentity } from '../identity/callerIdentity';
import { APP_LOGGER, type AppLogger } from '../logging/appLogger';
import type { InProcessFunctions } from '../postgrest/sqlBackedClient';
import { PortClients } from './portClients';

/** Injection token of the reachability check for a member-supplied address (replaced in tests). */
export const LINK_REACHABILITY_CHECK = Symbol('LINK_REACHABILITY_CHECK');

/**
 * The Edge Functions this server has taken over (ADR-009 phase 8), as the
 * hosted adapters call them: by name, with a JSON body. Each one is a native
 * module of this server; this class only binds it to the caller of a request.
 */
@Injectable()
export class HostedFunctions {
  constructor(
    @Inject(PortClients) private readonly clients: PortClients,
    @Inject(LINK_REACHABILITY_CHECK) private readonly checkReachable: (url: URL) => Promise<boolean>,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  /** The functions as `caller` may invoke them. */
  forCaller(caller: CallerIdentity | null): InProcessFunctions {
    return {
      'validate-donation-link': async (body) => ({
        status: 200,
        body: await submitDonationLink(await this.linkMember(caller), body, {
          checkReachable: this.checkReachable,
          links: createSqlLinkStore(this.clients.serviceClient()),
          report: (error, stage) => this.logger.error({ err: error, stage }, 'donation link write failed'),
        }),
      }),
    };
  }

  /** The caller as the donation link rules see them: who they are and whether they hold the super-admin role. */
  private async linkMember(caller: CallerIdentity | null): Promise<{ userId: string; isSuperAdmin: boolean } | null> {
    if (!caller) return null;
    const { data } = await this.clients.clientFor(caller).rpc('get_my_admin_roles');
    const roles = Array.isArray(data) ? (data as unknown[]) : [];
    return { userId: caller.userId, isSuperAdmin: roles.includes('super_admin') };
  }
}
