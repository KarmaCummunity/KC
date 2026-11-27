/**
 * "Show my active status": the member's own switch for whether others see them online.
 * Presence itself is realtime; this port only reads and stores the switch.
 */
export interface IActiveStatusRepository {
  /** The caller's setting; true (the default) when it was never set or nobody is signed in. */
  get(): Promise<boolean>;
  /** Stores the setting and returns it. */
  set(enabled: boolean): Promise<boolean>;
}
