// app/packages/application/src/ports/IImportTelemetryRepository.ts
// FR-IMPORT-010 AC4 — the team's read of the external post import: the funnel and the per-field
// edit rate. Counts only; nothing identifies a member.

/** Attempts of the window by outcome (`admin_import_funnel`). */
export interface ImportFunnel {
  readonly attempts: number;
  /** Attempts that ended on the manual route (a limit, nothing to extract, a failure). */
  readonly manual: number;
  /** Attempts that produced a draft (ready or confirm). */
  readonly drafted: number;
  readonly published: number;
  /** Drafts never published within a day. */
  readonly discarded: number;
  /** Attempts that called the model (the cost). */
  readonly providerCalls: number;
}

/** One draft field's `import_field_edit_rate` over the published imports that reported their edits. */
export interface ImportFieldEditRate {
  readonly field: string;
  readonly reported: number;
  readonly edited: number;
  /** 0..1; null when no published import reported its edits. */
  readonly editRate: number | null;
}

export interface IImportTelemetryRepository {
  getFunnel(days: number): Promise<ImportFunnel>;
  getFieldEditRates(days: number): Promise<ImportFieldEditRate[]>;
}
