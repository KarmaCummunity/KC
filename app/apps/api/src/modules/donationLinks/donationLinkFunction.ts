import { Inject, Injectable } from '@nestjs/common';
import type { CallerIdentity } from '../../platform/identity/callerIdentity';
import { APP_LOGGER, type AppLogger } from '../../platform/logging/appLogger';
import type { FunctionAnswer, FunctionRequest, HostedFunction } from '../../platform/ports/hostedFunction';
import { PortClients } from '../../platform/ports/portClients';
import { type LinkMember, submitDonationLink } from './donationLinkService';
import { createSqlLinkStore } from './sqlLinkStore';

/** Injection token of the reachability check for a member-supplied address (replaced in tests). */
export const LINK_REACHABILITY_CHECK = Symbol('LINK_REACHABILITY_CHECK');

/**
 * `validate-donation-link` as the hosted adapter invokes it (FR-DONATE-007..009).
 * The rules are in `donationLinkService.ts`; this class only gives them the
 * caller, the table and the outbound check.
 */
@Injectable()
export class DonationLinkFunction implements HostedFunction {
  readonly name = 'validate-donation-link';

  constructor(
    @Inject(PortClients) private readonly clients: PortClients,
    @Inject(LINK_REACHABILITY_CHECK) private readonly checkReachable: (url: URL) => Promise<boolean>,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  /** Always HTTP 200: the service's answer says in its body whether the link was accepted. */
  async handle(request: FunctionRequest, body: unknown): Promise<FunctionAnswer> {
    const answer = await submitDonationLink(await this.linkMember(request.caller), body, {
      checkReachable: this.checkReachable,
      links: createSqlLinkStore(this.clients.serviceClient()),
      report: (error, stage) => this.logger.error({ err: error, stage }, 'donation link write failed'),
    });
    return { status: 200, body: answer };
  }

  /** The caller as the donation link rules see them: who they are and whether they hold the super-admin role. */
  private async linkMember(caller: CallerIdentity | null): Promise<LinkMember | null> {
    if (!caller) return null;
    const { data } = await this.clients.clientFor(caller).rpc('get_my_admin_roles');
    const roles = Array.isArray(data) ? (data as unknown[]) : [];
    return { userId: caller.userId, isSuperAdmin: roles.includes('super_admin') };
  }
}
