/**
 * Wire contract for the `validate-donation-link` Edge Function
 * (`supabase/functions/validate-donation-link/handler.ts`).
 *
 * App-layer only: mirrors the Edge request/response envelopes so the
 * infrastructure adapter and error mapper stay type-aligned with the server
 * without importing Deno modules (TD-114 / DON-7).
 */

/** Failure codes the Edge Function returns in `{ ok: false, code }`. */
export const VALIDATE_DONATION_LINK_EDGE_ERROR_CODES = [
  'invalid_input',
  'invalid_url',
  'unreachable',
  'forbidden',
  'unauthorized',
  'rate_limited',
  'server_error',
] as const;

export type ValidateDonationLinkEdgeErrorCode =
  (typeof VALIDATE_DONATION_LINK_EDGE_ERROR_CODES)[number];

/** POST body for insert (no `link_id`). */
export interface ValidateDonationLinkInsertBody {
  readonly category_slug: string;
  readonly url: string;
  readonly display_name: string;
  readonly description?: string | null;
}

/** POST body for update (`link_id` required). */
export interface ValidateDonationLinkUpdateBody {
  readonly link_id: string;
  readonly category_slug: string;
  readonly url: string;
  readonly display_name: string;
  readonly description?: string | null;
}

export type ValidateDonationLinkRequestBody =
  | ValidateDonationLinkInsertBody
  | ValidateDonationLinkUpdateBody;

/** Columns returned on success (member-facing; no search document). */
export interface ValidateDonationLinkRow {
  readonly id: string;
  readonly category_slug: string;
  readonly url: string;
  readonly display_name: string;
  readonly description: string | null;
  readonly submitted_by: string;
  readonly validated_at: string;
  readonly review_status: string;
  readonly review_note: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ValidateDonationLinkOkResponse {
  readonly ok: true;
  readonly link: ValidateDonationLinkRow;
}

export interface ValidateDonationLinkFailResponse {
  readonly ok: false;
  readonly code: ValidateDonationLinkEdgeErrorCode;
}

export type ValidateDonationLinkResponse =
  | ValidateDonationLinkOkResponse
  | ValidateDonationLinkFailResponse;

export function isValidateDonationLinkEdgeErrorCode(
  raw: unknown,
): raw is ValidateDonationLinkEdgeErrorCode {
  return (
    typeof raw === 'string' &&
    (VALIDATE_DONATION_LINK_EDGE_ERROR_CODES as readonly string[]).includes(raw)
  );
}
