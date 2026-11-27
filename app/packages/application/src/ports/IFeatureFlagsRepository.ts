/** Feature flags as the server stores them: flag key to on / off. */
export type FeatureFlagStates = Readonly<Record<string, boolean>>;

/** The launch and feature switches a signed-in member's app reads at start. */
export interface IFeatureFlagsRepository {
  /**
   * Every flag the server has a row for. Throws when the read fails: an empty
   * answer would look like "no flag is set" and switch features to their
   * compiled defaults.
   */
  listFlags(): Promise<FeatureFlagStates>;
}
