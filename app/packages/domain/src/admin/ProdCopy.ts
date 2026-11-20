// FR-ADMIN-037 — the weekly anonymized copy of production that kc-dev holds, as the admin
// portal's Demo data screen shows it ("Copied from production" card, AC13). Refusals reuse
// DemoDataError: the card sits on the same screen, behind the same role, and its RPCs belong to
// the same family of dev-only seed tools.

/** What the copy holds now (admin_prod_copy_status). */
export interface ProdCopyStatus {
  readonly members: number;
  readonly posts: number;
  readonly organizations: number;
  readonly follows: number;
  readonly savedPosts: number;
  /** ISO time of the last successful copy; null when none ran (or none since the tools came). */
  readonly lastCopiedAt: string | null;
}

/** What "Delete copied data" deleted (admin_delete_prod_copy). */
export interface ProdCopyDeleteResult {
  readonly members: number;
  readonly posts: number;
  readonly organizations: number;
}

/** True when anything copied exists, so the card offers "Delete copied data". */
export function hasProdCopyData(status: ProdCopyStatus): boolean {
  return status.members + status.organizations > 0;
}
