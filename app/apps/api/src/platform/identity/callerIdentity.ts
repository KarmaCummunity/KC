/** The signed-in user a request acts as, established from a verified access token. */
export interface CallerIdentity {
  readonly userId: string;
  /**
   * The token's verified claims. Handed to the database for the request's
   * transaction, where `auth.uid()`, `auth.jwt()` and the RLS policies read them.
   */
  readonly claims: Readonly<Record<string, unknown>>;
}
