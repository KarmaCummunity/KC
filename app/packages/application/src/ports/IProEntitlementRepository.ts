/** Whether the signed-in member holds the Pro subscription. */
export interface IProEntitlementRepository {
  /** True when the server records an active Pro entitlement for the caller. */
  isPro(): Promise<boolean>;
}
