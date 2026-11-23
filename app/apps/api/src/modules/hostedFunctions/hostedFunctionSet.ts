import { DonationLinkFunction, LINK_REACHABILITY_CHECK } from '../donationLinks/donationLinkFunction';
import { checkReachable } from '../donationLinks/reachability';
import { ResearchSubmitFunction } from '../publicResearch/researchSubmitFunction';
import type { HostedFunctionSet } from '../../platform/ports/hostedFunction';

/** Outbound checks a test replaces, so no test reaches the network. */
export interface HostedFunctionOverrides {
  readonly checkReachable?: (url: URL) => Promise<boolean>;
}

/**
 * Every Edge Function this server has taken over (ADR-009 phase 8). A newly
 * ported function is added here and nowhere else: the gateway and the
 * registry are generic.
 */
export function hostedFunctionSet(overrides: HostedFunctionOverrides = {}): HostedFunctionSet {
  return {
    functions: [DonationLinkFunction, ResearchSubmitFunction],
    providers: [{ provide: LINK_REACHABILITY_CHECK, useValue: overrides.checkReachable ?? ((url: URL) => checkReachable(url)) }],
  };
}
