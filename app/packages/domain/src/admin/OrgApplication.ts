// V2-ADMIN-ORG-7 — domain types for NGO org applications.

export const ORG_APPLICATION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type OrgApplicationStatus = (typeof ORG_APPLICATION_STATUSES)[number];

export function parseOrgApplicationStatus(
  value: string | null | undefined,
): OrgApplicationStatus | null {
  if (value == null) return null;
  return (ORG_APPLICATION_STATUSES as readonly string[]).includes(value)
    ? (value as OrgApplicationStatus)
    : null;
}

export interface OrgApplication {
  readonly applicationId: string;
  readonly applicantUserId: string;
  readonly applicantName: string | null;
  readonly orgName: string;
  readonly orgDescription: string | null;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly websiteUrl: string | null;
  readonly status: OrgApplicationStatus;
  readonly createdAt: Date;
  readonly reviewedAt: Date | null;
  readonly reviewedBy: string | null;
  readonly reviewerName: string | null;
  readonly reviewNote: string | null;
}

export interface OrgApplicationPage {
  readonly rows: readonly OrgApplication[];
  readonly totalCount: number;
}

export type OrgApplicationErrorCode =
  | 'forbidden'
  | 'invalid_status'
  | 'application_not_found'
  | 'application_already_decided'
  /** The organization's web address is missing or not in the allowed form. */
  | 'invalid_slug'
  /** Another organization already has this web address. */
  | 'slug_taken'
  | 'unknown';

export class OrgApplicationError extends Error {
  constructor(public readonly code: OrgApplicationErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'OrgApplicationError';
  }
}

export function isOrgApplicationError(value: unknown): value is OrgApplicationError {
  return value instanceof OrgApplicationError;
}
