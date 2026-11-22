// FR-SETTINGS-012 / FR-AUTH-016: while Settings shows "account deleted" and then signs the device
// out, the account gate must not replace that confirmation with the restore screen (the deletion
// pushes `account_changed` at once). Settings pauses the gate's restore routing for that window.
let pausedUntil = 0;

/** Holds the account gate's restore-screen routing for `ms` milliseconds. */
export function pauseRestoreRouting(ms: number): void {
  pausedUntil = Date.now() + ms;
}

/** True while the restore-screen routing is held. */
export function restoreRoutingPaused(): boolean {
  return Date.now() < pausedUntil;
}
