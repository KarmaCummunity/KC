// FR-FIN-023 — admin-only donors overview: cleared donation/grant entries grouped by counterparty.
// Donors are identified by the free-text counterparty (case/space-insensitive); this view is
// never exposed publicly (FR-FIN-019 AC6).

export interface FinanceDonorSummary {
  /** Most recently typed spelling of the donor; null groups all entries without a counterparty. */
  readonly donorName: string | null;
  readonly donationsCount: number;
  readonly totalCents: number;
  readonly firstAt: Date;
  readonly lastAt: Date;
}
