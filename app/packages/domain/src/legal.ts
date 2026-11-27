/** Which legal document the member must acknowledge (terms of use or privacy policy). */
export type LegalDocType = 'terms' | 'privacy';

/**
 * How material a legal-version change is for re-acknowledgement UX.
 * @invariant `critical` / `standard` may force a modal; `minor` is typically banner-only.
 */
export type LegalSeverity = 'minor' | 'standard' | 'critical';

/**
 * How the client blocks the member until they re-acknowledge a pending legal version.
 * @invariant Server (`needs_legal_reacknowledgement`) is the source of truth; the client never derives this from local time.
 */
export type LegalBlockMode = 'banner' | 'modal';

/** Current published pointer for a legal document type (version + material-change metadata). */
export interface LegalDocument {
  readonly docType: LegalDocType;
  readonly currentVersion: number;
  readonly currentEffectiveDate: Date;
  readonly lastMaterialVersion: number;
  readonly lastMaterialSeverity: LegalSeverity | null;
}

/** Full published body of one version of a legal document. */
export interface LegalDocumentContent {
  readonly docType: LegalDocType;
  readonly version: number;
  readonly effectiveDate: Date;
  /** Markdown body shown to the member. */
  readonly bodyMd: string;
  /** Content hash used to detect republish drift. */
  readonly contentHash: string;
  readonly severity: LegalSeverity;
  readonly changeSummary: string | null;
  readonly publishedAt: Date;
}

/**
 * A legal version the signed-in member has not yet accepted, with the block mode the server chose.
 */
export interface LegalPendingItem {
  readonly docType: LegalDocType;
  readonly currentVersion: number;
  readonly currentEffectiveDate: Date;
  readonly lastAcceptedVersion: number;
  readonly severity: LegalSeverity;
  readonly blockMode: LegalBlockMode;
}

/**
 * Whether any pending legal item must hard-block the member (modal) before continuing.
 * @param pending Items from the server's needs-reacknowledgement payload.
 * @returns `true` when at least one item uses `blockMode === 'modal'`.
 */
export function shouldBlockImmediately(pending: LegalPendingItem[]): boolean {
  return pending.some((p) => p.blockMode === 'modal');
}
